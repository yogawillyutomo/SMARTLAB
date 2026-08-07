export * from './types';
export { validateLaboratoryLayout } from './validation';
export { moveLayoutElement, swapLayoutElements } from './operations';
export { migrateLegacyDeviceCoordinates } from './legacyMigration';
export { inspectLaboratoryDependencies } from './laboratoryDependencies';
export {
  cloneLaboratoryLayout,
  createInitialLaboratoryDevices,
  createLaboratoryWithInitialLayout,
  deleteLaboratorySafely,
  getActiveLaboratoryLayout,
  layoutFingerprint,
  layoutsEquivalent,
  saveActiveLaboratoryLayout,
  validatePersistedLaboratoryLayouts,
} from './persistence';
export type {
  ActiveLayoutResult,
  CreateLaboratoryWithInitialLayoutInput,
  DeleteLaboratorySafelyInput,
  LayoutActor,
  LayoutPersistenceFailure,
  PersistedLayoutIntegrityIssue,
  PersistedLayoutIntegrityResult,
  SaveActiveLaboratoryLayoutInput,
  SaveLayoutResult,
} from './persistence';
export {
  PHYSICAL_LAYOUT_TEMPLATE_REGISTRY,
  PHYSICAL_TEMPLATE_AISLE_SLOTS,
  RPL_PERIMETER_CENTER_ISLAND_36,
  checkPhysicalLayoutTemplateCompatibility,
  generatePhysicalLayoutTemplateDraft,
  getPhysicalLayoutTemplate,
  sortTemplateStudentDevices,
  validatePhysicalLayoutTemplateStructure,
} from './templates';
export type {
  GeneratePhysicalLayoutTemplateInput,
  GeneratePhysicalLayoutTemplateResult,
  PhysicalLayoutTemplateDefinition,
  PhysicalLayoutTemplateId,
  TemplateCompatibilityIssue,
  TemplateCompatibilityResult,
} from './templates';
