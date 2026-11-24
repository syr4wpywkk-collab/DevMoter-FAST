export * as zipInternal from './src/internal/zip';
export { readOutline } from './src/read';
export {
  replaceText,
  removeSlide,
  duplicateSlide,
  moveSlide,
  addBlankSlide,
} from './src/edit';
export { renderPlan, planToSpec } from './src/plan';
export { deckPlanSchema, validatePlan, parsePlan } from './src/plan-schema';
export { renderExtDeck } from './src/render-ext';
export type { DeckOutline, SlideOutline } from './src/read';
export type { DeckPlan, PlanSlide } from './src/plan';
export type { ExtDeckSpec, MasterSpec } from './src/spec-ext';
