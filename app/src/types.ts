export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface CandidateMatch {
  classIdx: number;
  partId: string;
  partName: string;
  prob: number;
  logit: number;
  aliases: string[];
}

export interface InferredColor {
  code: number;      // Official LDraw / Rebrickable code (e.g. 4 for Red)
  name: string;      // Official color name (e.g. "Red")
  hex: string;       // Official color hex (e.g. "#C91A09")
  deltaE: number;    // CIEDE2000 perceptual distance
  sampleHex: string; // Measured raw median hex
}

export interface DetectedRegion {
  id: number;
  box: BoundingBox;        // Coordinates in image pixels
  normBox: BoundingBox;    // Normalized [0, 1]
  polygon?: Point2D[];     // Vector polyline in image coordinates
  partId: string;          // e.g. "3001"
  partName: string;        // e.g. "Brick  2 x  4"
  confidence: number;      // 0.0 to 1.0
  classIdx: number;        // 0 to 900
  aliases: string[];       // LDraw variant names, e.g. ["3556", "4747"]
  thumbnailUrl: string;    // e.g. "/thumbnails/3001.png"
  candidates?: CandidateMatch[]; // Top-K candidate classifications for scale re-ranking
  estimatedStuds?: { m: number; n: number; area: number }; // Inferred physical stud dimension
  colorInfo?: InferredColor; // Inferred official LEGO color
}

export interface PartSummary {
  partId: string;
  name: string;
  count: number;
  thumbnail: string;
  aliases: string[];
  maxConfidence: number;
  colors?: InferredColor[]; // Unique colors detected across instances
}

export interface ClassItem {
  idx: number;
  id: string;
  name: string;
  ldraw: string;
}

export interface ClassesData {
  model_architecture: string;
  num_classes: number;
  input_shape: number[];
  classes: ClassItem[];
}

export interface AtlasPartInfo {
  idx: number;
  id: string;
  name: string;
  col: number;
  row: number;
  x: number;
  y: number;
  uMin: number;
  vMin: number;
  uMax: number;
  vMax: number;
  aliases: string[];
  thumbnail: string;
}

export interface AtlasIndexData {
  tileSize: number;
  cols: number;
  rows: number;
  atlasWidth: number;
  atlasHeight: number;
  totalParts: number;
  parts: Record<string, AtlasPartInfo>;
}

export interface ClipboardInventoryItem {
  part_id: string;        // e.g. "3001"
  name: string;           // e.g. "Brick 2 x 4"
  count: number;          // quantity detected
  max_confidence: number; // rounded to 2 decimals (e.g. 0.89)
  avg_confidence: number; // average confidence across instances
  color: number;          // official color code (e.g. 4 for Red)
  color_name: string;     // official color name (e.g. "Red")
  color_hex: string;      // official color hex (e.g. "#C91A09")
  sample_hex?: string;    // measured raw hex from image
}

export interface ClipboardPayload {
  confidence_range: [number, number]; // [min, max] percentages
  total_pieces: number;
  unique_parts: number;
  inventory: ClipboardInventoryItem[];
}
