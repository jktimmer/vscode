/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from 'vs/base/common/async';
import { Disposable } from 'vs/base/common/lifecycle';
import { FileAccess } from 'vs/base/common/network';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { localize } from 'vs/nls';
import { IObservable, observableFromEvent, derived } from 'vs/base/common/observable';

export const IAudioCueService = createDecorator<IAudioCueService>('audioCue');

export interface IAudioCueService {
	readonly _serviceBrand: undefined;
	playAudioCue(cue: AudioCue, allowManyInParallel?: boolean): Promise<void>;
	playAudioCues(cues: AudioCue[]): Promise<void>;
	isEnabled(cue: AudioCue): IObservable<boolean>;

	playSound(cue: Sound, allowManyInParallel?: boolean): Promise<void>;
}

export class AudioCueService extends Disposable implements IAudioCueService {
	readonly _serviceBrand: undefined;

	private readonly screenReaderAttached = observableFromEvent(
		this.accessibilityService.onDidChangeScreenReaderOptimized,
		() => /** @description accessibilityService.onDidChangeScreenReaderOptimized */ this.accessibilityService.isScreenReaderOptimized()
	);

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService
	) {
		super();
	}

	public async playAudioCue(cue: AudioCue, allowManyInParallel = false): Promise<void> {
		if (this.isEnabled(cue).get()) {
			await this.playSound(cue.sound, allowManyInParallel);
		}
	}

	public async playAudioCues(cues: AudioCue[]): Promise<void> {
		// Some audio cues might reuse sounds. Don't play the same sound twice.
		const sounds = new Set(cues.filter(cue => this.isEnabled(cue).get()).map(cue => cue.sound));
		await Promise.all(Array.from(sounds).map(sound => this.playSound(sound)));
	}

	private getVolumeInPercent(): number {
		const volume = this.configurationService.getValue<number>('audioCues.volume');
		if (typeof volume !== 'number') {
			return 50;
		}

		return Math.max(Math.min(volume, 100), 0);
	}

	private playingSounds = new Set<Sound>();

	public async playSound(sound: Sound, allowManyInParallel = false): Promise<void> {
		if (!allowManyInParallel && this.playingSounds.has(sound)) {
			return;
		}

		this.playingSounds.add(sound);

		const url = FileAccess.asBrowserUri(
			`vs/platform/audioCues/common/media/${sound.fileName}`
		).toString();
		const audio = new Audio(url);
		audio.volume = this.getVolumeInPercent() / 100;
		audio.addEventListener('ended', () => {
			this.playingSounds.delete(sound);
		});
		try {
			try {
				// Don't play when loading takes more than 1s, due to loading, decoding or playing issues.
				// Delayed sounds are very confusing.
				await raceTimeout(audio.play(), 1000);
			} catch (e) {
				console.error('Error while playing sound', e);
			}
		} finally {
			audio.remove();
		}
	}

	private readonly obsoleteAudioCuesEnabled = observableFromEvent(
		Event.filter(this.configurationService.onDidChangeConfiguration, (e) =>
			e.affectsConfiguration('audioCues.enabled')
		),
		() => /** @description config: audioCues.enabled */ this.configurationService.getValue<'on' | 'off' | 'auto'>('audioCues.enabled')
	);

	private readonly isEnabledCache = new Cache((cue: AudioCue) => {
		const settingObservable = observableFromEvent(
			Event.filter(this.configurationService.onDidChangeConfiguration, (e) =>
				e.affectsConfiguration(cue.settingsKey)
			),
			() => this.configurationService.getValue<'on' | 'off' | 'auto'>(cue.settingsKey)
		);
		return derived('audio cue enabled', reader => {
			const setting = settingObservable.read(reader);
			if (
				setting === 'on' ||
				(setting === 'auto' && this.screenReaderAttached.read(reader))
			) {
				return true;
			}

			const obsoleteSetting = this.obsoleteAudioCuesEnabled.read(reader);
			if (
				obsoleteSetting === 'on' ||
				(obsoleteSetting === 'auto' && this.screenReaderAttached.read(reader))
			) {
				return true;
			}

			return false;
		});
	});

	public isEnabled(cue: AudioCue): IObservable<boolean> {
		return this.isEnabledCache.get(cue);
	}
}

class Cache<TArg, TValue> {
	private readonly map = new Map<TArg, TValue>();
	constructor(private readonly getValue: (value: TArg) => TValue) {
	}

	public get(arg: TArg): TValue {
		if (this.map.has(arg)) {
			return this.map.get(arg)!;
		}

		const value = this.getValue(arg);
		this.map.set(arg, value);
		return value;
	}
}

/**
 * Corresponds to the audio files in ./media.
*/
export class Sound {
	private static register(options: { fileName: string }): Sound {
		const sound = new Sound(options.fileName);
		return sound;
	}


	public static readonly error = Sound.register({ fileName: 'error.mp3' });
	public static readonly warning = Sound.register({ fileName: 'warning.mp3' });
	public static readonly foldedArea = Sound.register({ fileName: 'foldedAreas.mp3' });
	public static readonly break = Sound.register({ fileName: 'break.mp3' });
	public static readonly quickFixes = Sound.register({ fileName: 'quickFixes.mp3' });
	public static readonly taskCompleted = Sound.register({ fileName: 'taskCompleted.mp3' });
	public static readonly taskFailed = Sound.register({ fileName: 'taskFailed.mp3' });
	public static readonly terminalBell = Sound.register({ fileName: 'terminalBell.mp3' });
	public static readonly diffLineInserted = Sound.register({ fileName: 'diffLineInserted.mp3' });
	public static readonly diffLineDeleted = Sound.register({ fileName: 'diffLineDeleted.mp3' });

	private constructor(public readonly fileName: string) { }
}

export class AudioCue {
	private static _audioCues = new Set<AudioCue>();

	private static register(options: {
		name: string;
		sound: Sound;
		settingsKey: string;
	}): AudioCue {
		const audioCue = new AudioCue(options.sound, options.name, options.settingsKey);
		AudioCue._audioCues.add(audioCue);
		return audioCue;
	}

	public static get allAudioCues() {
		return [...this._audioCues];
	}

	public static readonly error = AudioCue.register({
		name: localize('audioCues.lineHasError.name', 'Error on Line'),
		sound: Sound.error,
		settingsKey: 'audioCues.lineHasError',
	});
	public static readonly warning = AudioCue.register({
		name: localize('audioCues.lineHasWarning.name', 'Warning on Line'),
		sound: Sound.warning,
		settingsKey: 'audioCues.lineHasWarning',
	});
	public static readonly foldedArea = AudioCue.register({
		name: localize('audioCues.lineHasFoldedArea.name', 'Folded Area on Line'),
		sound: Sound.foldedArea,
		settingsKey: 'audioCues.lineHasFoldedArea',
	});
	public static readonly break = AudioCue.register({
		name: localize('audioCues.lineHasBreakpoint.name', 'Breakpoint on Line'),
		sound: Sound.break,
		settingsKey: 'audioCues.lineHasBreakpoint',
	});
	public static readonly inlineSuggestion = AudioCue.register({
		name: localize('audioCues.lineHasInlineSuggestion.name', 'Inline Suggestion on Line'),
		sound: Sound.quickFixes,
		settingsKey: 'audioCues.lineHasInlineSuggestion',
	});

	public static readonly terminalQuickFix = AudioCue.register({
		name: localize('audioCues.terminalQuickFix.name', 'Terminal Quick Fix'),
		sound: Sound.quickFixes,
		settingsKey: 'audioCues.terminalQuickFix',
	});

	public static readonly onDebugBreak = AudioCue.register({
		name: localize('audioCues.onDebugBreak.name', 'Debugger Stopped on Breakpoint'),
		sound: Sound.break,
		settingsKey: 'audioCues.onDebugBreak',
	});

	public static readonly noInlayHints = AudioCue.register({
		name: localize('audioCues.noInlayHints', 'No Inlay Hints on Line'),
		sound: Sound.error,
		settingsKey: 'audioCues.noInlayHints'
	});

	public static readonly taskCompleted = AudioCue.register({
		name: localize('audioCues.taskCompleted', 'Task Completed'),
		sound: Sound.taskCompleted,
		settingsKey: 'audioCues.taskCompleted'
	});

	public static readonly taskFailed = AudioCue.register({
		name: localize('audioCues.taskFailed', 'Task Failed'),
		sound: Sound.taskFailed,
		settingsKey: 'audioCues.taskFailed'
	});

	public static readonly terminalBell = AudioCue.register({
		name: localize('audioCues.terminalBell', 'Terminal Bell'),
		sound: Sound.terminalBell,
		settingsKey: 'audioCues.terminalBell'
	});

	public static readonly diffLineInserted = AudioCue.register({
		name: localize('audioCues.diffLineInserted', 'Diff Line Inserted'),
		sound: Sound.diffLineInserted,
		settingsKey: 'audioCues.diffLineInserted'
	});

	public static readonly diffLineDeleted = AudioCue.register({
		name: localize('audioCues.diffLineDeleted', 'Diff Line Deleted'),
		sound: Sound.diffLineDeleted,
		settingsKey: 'audioCues.diffLineDeleted'
	});

	private constructor(
		public readonly sound: Sound,
		public readonly name: string,
		public readonly settingsKey: string,
	) { }
}
