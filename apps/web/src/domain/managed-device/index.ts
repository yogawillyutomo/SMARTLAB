export {
  DEVICE_LIFECYCLE_STATUSES,
  MANAGED_DEVICE_TYPES,
  findDeviceByQrPublicId,
  generateDeviceQrPublicId,
  getAssetDeviceLink,
  getDeviceInventoryLinkStatus,
  isDeviceLifecycleStatus,
  isManagedDeviceType,
  isValidQrPublicId,
  migrateLegacyManagedDevices,
  validateAssetMutation,
  validateManagedDeviceInventory,
} from './identity';
export type {
  AssetDeviceLinkStatus,
  AssetMutationPolicyResult,
  AssetMutationRequest,
  DeviceInventoryLinkStatus,
  DeviceQrResolutionResult,
  ManagedDeviceIntegrityIssue,
  ManagedDeviceIntegrityIssueCode,
  ManagedDeviceMigrationIssue,
  ManagedDeviceMigrationResult,
  QrPublicIdFactory,
} from './identity';
export {
  DEVICE_LIFECYCLE_TRANSITIONS,
  canTransitionDeviceLifecycle,
  changeDeviceLifecycle,
} from './lifecycle';
export type {
  DeviceLifecycleActor,
  DeviceLifecycleTransitionResult,
} from './lifecycle';
