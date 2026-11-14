// Units: LDU, Y up. One stud = 20 LDU (x, z), one plate = 8 LDU (y), the same as the app (claude/app/src/lego/constants.js).
// The packer works on SUB-VOXELS of 4 LDU: 5 per stud along x and z (the app's G), 2 per plate along y. A part is placed on the
// stud / plate lattice (CELLS of 20 x 8 x 20 LDU), its volume is described on the sub-voxel grid with fractional coverage.
export const STUD = 20, PLATE = 8, H = 4;           // LDU
export const SX = 5, SY = 2;                         // sub-voxels per cell along x / z, and along y
export const STUD_R = 6, STUD_H = 4;                 // LDraw stud: radius 6 LDU, 4 LDU tall
