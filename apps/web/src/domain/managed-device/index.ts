export {
  DEVICE_LIFECYCLE_STATUSES,
  MANAGED_DEVICE_TYPES,
  findDeviceByQrPublicId,
  generateDeviceQrPublicId,
  getDeviceInventoryLinkStatus,
  isDeviceLifecycleStatus,
  isManagedDeviceType,
  isValidQrPublicId,
  migrateLegacyManagedDevices,
  validateManagedDeviceInventory,
} from './identity';
export type {
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
