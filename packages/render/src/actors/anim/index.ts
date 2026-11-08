// Animação dos bonecos do FutBobo (#56, PLANO do porte §B6 e §C7): contrato em `types.ts` (congelado); o corpo de
// `createFigureRig` é da frente F4 (`rig.ts`), com os ganhos em `motion-config.ts`. Sem three.
export { FIGURE_POSE_RESULT, type FigureLodStats, type FigurePoseResult, type FigureRig } from './types.ts';
export { ANIM_FIELD, ANIM_FIELDS, createFigureRig, FIGURE_LOD, type FigureRigOptions } from './rig.ts';
export { FIGURE_MOTION, FIGURE_MOTION_STOPPED, FIGURE_U_PER_M, type FigureMotionConfig } from './motion-config.ts';
