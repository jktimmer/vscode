/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { DEFAULT_PROFILE_EXTENSIONS_MIGRATION_KEY, IExtensionGalleryService, IGlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionStorageService, IExtensionStorageService } from 'vs/platform/extensionManagement/common/extensionStorage';
import { migrateUnsupportedExtensions } from 'vs/platform/extensionManagement/common/unsupportedExtensionsMigration';
import { INativeServerExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';

export class ExtensionsContributions extends Disposable {
	constructor(
		@INativeServerExtensionManagementService extensionManagementService: INativeServerExtensionManagementService,
		@IExtensionGalleryService extensionGalleryService: IExtensionGalleryService,
		@IExtensionStorageService extensionStorageService: IExtensionStorageService,
		@IGlobalExtensionEnablementService extensionEnablementService: IGlobalExtensionEnablementService,
		@IStorageService storageService: IStorageService,
		@ILogService logService: ILogService,
	) {
		super();

		extensionManagementService.migrateDefaultProfileExtensions()
			.then(() => storageService.store(DEFAULT_PROFILE_EXTENSIONS_MIGRATION_KEY, true, StorageScope.APPLICATION, StorageTarget.MACHINE), error => null);

		extensionManagementService.removeUninstalledExtensions();
		migrateUnsupportedExtensions(extensionManagementService, extensionGalleryService, extensionStorageService, extensionEnablementService, logService);
		ExtensionStorageService.removeOutdatedExtensionVersions(extensionManagementService, storageService);
	}

}
