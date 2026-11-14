"""Universal LEGO LDU and BrickPack sub-voxel constants."""

STUD = 20       # 1 stud pitch in LDU
PLATE = 8       # 1 plate height in LDU (1 brick = 3 plates = 24 LDU)
H = 4           # 4-LDU isotropic sub-voxel pitch
SX = STUD // H  # 5 sub-voxels per stud X/Z
SY = PLATE // H # 2 sub-voxels per plate Y
STUD_R = 6      # stud cylinder radius (LDU)
STUD_H = 4      # stud cylinder height (LDU)
