export * from './types';
export { validateLaboratoryLayout } from './validation';
export { moveLayoutElement, swapLayoutElements } from './operations';
export {
  LAYOUT_ELEMENT_LABEL_MAX_LENGTH,
  LAYOUT_ELEMENT_ROTATIONS,
  LAYOUT_ELEMENT_TYPE_DISPLAY_NAMES,
  getLayoutElementPropertyCapabilities,
  updateLayoutElementProperties,
} from './elementPropertyOperations';
export type {
  ElementPropertyFailureReason,
  LayoutElementPropertyCapabilities,
  LayoutElementPropertyPatch,
  UpdateLayoutElementPropertiesInput,
  UpdateLayoutElementPropertiesResult,
} from './elementPropertyOperations';
export {
  CUSTOM_LAYOUT_MAX_COLUMNS,
  CUSTOM_LAYOUT_MAX_ROWS,
  CUSTOM_LAYOUT_MIN_COLUMNS,
  CUSTOM_LAYOUT_MIN_ROWS,
  analyzeCustomLayoutResize,
  convertLayoutToCustom,
  resizeCustomLayout,
} from './customLayoutOperations';
export type {
  AnalyzeCustomLayoutResizeInput,
  ConvertLayoutToCustomInput,
  ConvertLayoutToCustomResult,
  CustomLayoutBlockingElement,
  CustomLayoutFailure,
  CustomLayoutFailureReason,
  CustomLayoutResizeAnalysis,
  ResizeCustomLayoutInput,
  ResizeCustomLayoutResult,
} from './customLayoutOperations';
export {
  PALETTE_DEVICE_MANAGED_ELEMENT_TYPES,
  PALETTE_ELEMENT_DISPLAY_NAMES,
  PALETTE_PLACEABLE_ELEMENT_TYPES,
  LABORATORY_LAYOUT_TYPE_DISPLAY_NAMES,
  canEditLayoutStructure,
  getPaletteElementDefaults,
  placeLayoutElement,
  removeLayoutElement,
  type PaletteOperationResult,
  type PalettePlaceableElementType,
} from './paletteOperations';
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
