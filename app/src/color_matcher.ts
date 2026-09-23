import type { BoundingBox, Point2D, DetectedRegion, InferredColor } from './types';

export interface LegoPaletteColor {
  code: number;
  name: string;
  hex: string;
  lab: [number, number, number];
  numSets: number;
}

/**
 * Pre-compiled official LEGO solid colors palette from Rebrickable & LDraw database.
 * Precomputed CIE L*a*b* coordinates for instant in-browser Delta E evaluation.
 */
export const LEGO_SOLID_PALETTE: LegoPaletteColor[] = [
  {
    "code": 0,
    "name": "Black",
    "hex": "#05131D",
    "lab": [
      5.3,
      -1.66,
      -8.37
    ],
    "numSets": 233644
  },
  {
    "code": 15,
    "name": "White",
    "hex": "#FFFFFF",
    "lab": [
      100,
      0,
      0
    ],
    "numSets": 152922
  },
  {
    "code": 71,
    "name": "Light Bluish Gray",
    "hex": "#A0A5A9",
    "lab": [
      67.46,
      -0.99,
      -2.68
    ],
    "numSets": 136664
  },
  {
    "code": 72,
    "name": "Dark Bluish Gray",
    "hex": "#6C6E68",
    "lab": [
      46.1,
      -1.98,
      3.08
    ],
    "numSets": 105475
  },
  {
    "code": 4,
    "name": "Red",
    "hex": "#C91A09",
    "lab": [
      43.03,
      63.79,
      53.71
    ],
    "numSets": 96738
  },
  {
    "code": 14,
    "name": "Yellow",
    "hex": "#F2CD37",
    "lab": [
      83.35,
      -1.36,
      73.77
    ],
    "numSets": 72701
  },
  {
    "code": 70,
    "name": "Reddish Brown",
    "hex": "#582A12",
    "lab": [
      22.91,
      19.14,
      24.66
    ],
    "numSets": 51277
  },
  {
    "code": 1,
    "name": "Blue",
    "hex": "#0055BF",
    "lab": [
      38.3,
      21.23,
      -61.29
    ],
    "numSets": 50342
  },
  {
    "code": 19,
    "name": "Tan",
    "hex": "#E4CD9E",
    "lab": [
      83.25,
      1.13,
      26.37
    ],
    "numSets": 47849
  },
  {
    "code": 2,
    "name": "Green",
    "hex": "#237841",
    "lab": [
      44.48,
      -38.29,
      23.04
    ],
    "numSets": 27236
  },
  {
    "code": 7,
    "name": "Light Gray",
    "hex": "#9BA19D",
    "lab": [
      65.66,
      -2.91,
      1.33
    ],
    "numSets": 25185
  },
  {
    "code": 25,
    "name": "Orange",
    "hex": "#FE8A18",
    "lab": [
      68.98,
      37.68,
      71.21
    ],
    "numSets": 18227
  },
  {
    "code": 28,
    "name": "Dark Tan",
    "hex": "#958A73",
    "lab": [
      57.85,
      0.22,
      13.83
    ],
    "numSets": 17920
  },
  {
    "code": 272,
    "name": "Dark Blue",
    "hex": "#0A3463",
    "lab": [
      21.66,
      5.67,
      -31.68
    ],
    "numSets": 15679
  },
  {
    "code": 27,
    "name": "Lime",
    "hex": "#BBE90B",
    "lab": [
      86.44,
      -38.74,
      83.49
    ],
    "numSets": 15155
  },
  {
    "code": 320,
    "name": "Dark Red",
    "hex": "#720E0F",
    "lab": [
      23.43,
      41.45,
      28.5
    ],
    "numSets": 12959
  },
  {
    "code": 84,
    "name": "Medium Nougat",
    "hex": "#AA7D55",
    "lab": [
      55.96,
      12.54,
      28.57
    ],
    "numSets": 12676
  },
  {
    "code": 322,
    "name": "Medium Azure",
    "hex": "#36AEBF",
    "lab": [
      65.6,
      -26.93,
      -18.22
    ],
    "numSets": 10741
  },
  {
    "code": 191,
    "name": "Bright Light Orange",
    "hex": "#F8BB3D",
    "lab": [
      79.52,
      10.72,
      68.35
    ],
    "numSets": 10224
  },
  {
    "code": 179,
    "name": "Flat Silver",
    "hex": "#898788",
    "lab": [
      56.51,
      0.94,
      -0.27
    ],
    "numSets": 8800
  },
  {
    "code": 10,
    "name": "Bright Green",
    "hex": "#4B9F4A",
    "lab": [
      58.78,
      -43.19,
      36.41
    ],
    "numSets": 8638
  },
  {
    "code": 484,
    "name": "Dark Orange",
    "hex": "#A95500",
    "lab": [
      45.54,
      30.19,
      54.7
    ],
    "numSets": 8440
  },
  {
    "code": 8,
    "name": "Dark Gray",
    "hex": "#6D6E5C",
    "lab": [
      45.87,
      -3.81,
      9.93
    ],
    "numSets": 7803
  },
  {
    "code": 308,
    "name": "Dark Brown",
    "hex": "#352100",
    "lab": [
      14.65,
      6.2,
      21.68
    ],
    "numSets": 7095
  },
  {
    "code": 288,
    "name": "Dark Green",
    "hex": "#184632",
    "lab": [
      26.17,
      -21.29,
      7.47
    ],
    "numSets": 6495
  },
  {
    "code": 3,
    "name": "Dark Turquoise",
    "hex": "#008F9B",
    "lab": [
      54.04,
      -27.33,
      -15.49
    ],
    "numSets": 6458
  },
  {
    "code": 29,
    "name": "Bright Pink",
    "hex": "#E4ADC8",
    "lab": [
      76.41,
      24.23,
      -5.88
    ],
    "numSets": 6161
  },
  {
    "code": 78,
    "name": "Light Nougat",
    "hex": "#F6D7B3",
    "lab": [
      87.7,
      5.49,
      21.75
    ],
    "numSets": 6149
  },
  {
    "code": 85,
    "name": "Dark Purple",
    "hex": "#3F3691",
    "lab": [
      28.74,
      30.54,
      -49.19
    ],
    "numSets": 6101
  },
  {
    "code": 321,
    "name": "Dark Azure",
    "hex": "#078BC9",
    "lab": [
      54.79,
      -8.43,
      -40.62
    ],
    "numSets": 5951
  },
  {
    "code": 378,
    "name": "Sand Green",
    "hex": "#A0BCAC",
    "lab": [
      73.82,
      -12.68,
      4.92
    ],
    "numSets": 5448
  },
  {
    "code": 5,
    "name": "Dark Pink",
    "hex": "#C870A0",
    "lab": [
      58.42,
      40.84,
      -10.56
    ],
    "numSets": 5102
  },
  {
    "code": 26,
    "name": "Magenta",
    "hex": "#923978",
    "lab": [
      38.54,
      45,
      -17.51
    ],
    "numSets": 4849
  },
  {
    "code": 226,
    "name": "Bright Light Yellow",
    "hex": "#FFF03A",
    "lab": [
      93.4,
      -13.32,
      82.34
    ],
    "numSets": 3997
  },
  {
    "code": 6,
    "name": "Brown",
    "hex": "#583927",
    "lab": [
      27.15,
      11.46,
      16.78
    ],
    "numSets": 3787
  },
  {
    "code": 73,
    "name": "Medium Blue",
    "hex": "#5A93DB",
    "lab": [
      60.03,
      2.72,
      -42.35
    ],
    "numSets": 3513
  },
  {
    "code": 30,
    "name": "Medium Lavender",
    "hex": "#AC78BA",
    "lab": [
      57.8,
      31.87,
      -26.75
    ],
    "numSets": 3408
  },
  {
    "code": 323,
    "name": "Light Aqua",
    "hex": "#ADC3C0",
    "lab": [
      77.11,
      -8.04,
      -1.03
    ],
    "numSets": 3125
  },
  {
    "code": 212,
    "name": "Bright Light Blue",
    "hex": "#9FC3E9",
    "lab": [
      77.45,
      -3.2,
      -22.75
    ],
    "numSets": 2979
  },
  {
    "code": 379,
    "name": "Sand Blue",
    "hex": "#6074A1",
    "lab": [
      48.95,
      4.51,
      -26.55
    ],
    "numSets": 2908
  },
  {
    "code": 326,
    "name": "Olive Green",
    "hex": "#9B9A5A",
    "lab": [
      62.35,
      -9.38,
      33.67
    ],
    "numSets": 2630
  },
  {
    "code": 31,
    "name": "Lavender",
    "hex": "#E1D5ED",
    "lab": [
      86.85,
      8.47,
      -10.27
    ],
    "numSets": 2413
  },
  {
    "code": 1050,
    "name": "Coral",
    "hex": "#E45366",
    "lab": [
      55.73,
      57.5,
      20.02
    ],
    "numSets": 1879
  },
  {
    "code": 92,
    "name": "Nougat",
    "hex": "#D09168",
    "lab": [
      65.49,
      19.16,
      31.24
    ],
    "numSets": 1242
  },
  {
    "code": 158,
    "name": "Yellowish Green",
    "hex": "#DFEEA5",
    "lab": [
      91.48,
      -16.55,
      33.77
    ],
    "numSets": 1150
  },
  {
    "code": 1136,
    "name": "Reddish Orange",
    "hex": "#CA4C0B",
    "lab": [
      49.2,
      47.69,
      56.95
    ],
    "numSets": 910
  },
  {
    "code": 1062,
    "name": "Vibrant Yellow",
    "hex": "#EBD800",
    "lab": [
      85.39,
      -10.94,
      85.21
    ],
    "numSets": 698
  },
  {
    "code": 351,
    "name": "Medium Dark Pink",
    "hex": "#D86D96",
    "lab": [
      59.65,
      46.38,
      -2.72
    ],
    "numSets": 575
  },
  {
    "code": 1089,
    "name": "Warm Tan",
    "hex": "#CCA373",
    "lab": [
      69.66,
      8.85,
      30.65
    ],
    "numSets": 493
  },
  {
    "code": 22,
    "name": "Purple",
    "hex": "#81007B",
    "lab": [
      29.66,
      58.33,
      -33.52
    ],
    "numSets": 318
  },
  {
    "code": 74,
    "name": "Medium Green",
    "hex": "#73DCA1",
    "lab": [
      80.4,
      -43.7,
      19.79
    ],
    "numSets": 309
  },
  {
    "code": 462,
    "name": "Medium Orange",
    "hex": "#FFA70B",
    "lab": [
      75.41,
      22.98,
      78.02
    ],
    "numSets": 281
  },
  {
    "code": 13,
    "name": "Pink",
    "hex": "#E294A6",
    "lab": [
      69.54,
      31.75,
      2.79
    ],
    "numSets": 249
  },
  {
    "code": 1088,
    "name": "Medium Brown",
    "hex": "#755945",
    "lab": [
      40.18,
      8.58,
      16.02
    ],
    "numSets": 226
  },
  {
    "code": 1147,
    "name": "Blue Violet",
    "hex": "#A3A9FF",
    "lab": [
      71.81,
      17.83,
      -43.31
    ],
    "numSets": 199
  },
  {
    "code": 18,
    "name": "Light Yellow",
    "hex": "#FBE696",
    "lab": [
      91.37,
      -3.7,
      41.55
    ],
    "numSets": 187
  },
  {
    "code": 151,
    "name": "Very Light Bluish Gray",
    "hex": "#E6E3E0",
    "lab": [
      90.39,
      0.48,
      1.82
    ],
    "numSets": 153
  },
  {
    "code": 366,
    "name": "Earth Orange",
    "hex": "#FA9C1C",
    "lab": [
      72.36,
      26.85,
      72.54
    ],
    "numSets": 132
  },
  {
    "code": 118,
    "name": "Aqua",
    "hex": "#B3D7D1",
    "lab": [
      83.33,
      -13.02,
      -0.99
    ],
    "numSets": 130
  },
  {
    "code": 17,
    "name": "Light Green",
    "hex": "#C2DAB8",
    "lab": [
      84.52,
      -14.19,
      14.08
    ],
    "numSets": 125
  },
  {
    "code": 20,
    "name": "Light Violet",
    "hex": "#C9CAE2",
    "lab": [
      81.92,
      4.29,
      -11.98
    ],
    "numSets": 125
  },
  {
    "code": 110,
    "name": "Violet",
    "hex": "#4354A3",
    "lab": [
      38.16,
      18.04,
      -44.88
    ],
    "numSets": 119
  },
  {
    "code": 12,
    "name": "Salmon",
    "hex": "#F2705E",
    "lab": [
      62.74,
      48.66,
      34.14
    ],
    "numSets": 115
  },
  {
    "code": 178,
    "name": "Flat Dark Gold",
    "hex": "#B48455",
    "lab": [
      58.85,
      12.88,
      32.46
    ],
    "numSets": 113
  },
  {
    "code": 100,
    "name": "Light Salmon",
    "hex": "#FEBABD",
    "lab": [
      81.77,
      24.95,
      8.2
    ],
    "numSets": 111
  },
  {
    "code": 115,
    "name": "Medium Lime",
    "hex": "#C7D23C",
    "lab": [
      81.05,
      -21.77,
      68.64
    ],
    "numSets": 105
  },
  {
    "code": 86,
    "name": "Light Brown",
    "hex": "#7C503A",
    "lab": [
      38.43,
      15.85,
      20.51
    ],
    "numSets": 101
  },
  {
    "code": 313,
    "name": "Maersk Blue",
    "hex": "#3592C3",
    "lab": [
      57.32,
      -10.94,
      -33.21
    ],
    "numSets": 101
  },
  {
    "code": 1051,
    "name": "Pastel Blue",
    "hex": "#5AC4DA",
    "lab": [
      74.01,
      -24.17,
      -20.19
    ],
    "numSets": 101
  },
  {
    "code": 77,
    "name": "Light Pink",
    "hex": "#EDB8BC",
    "lab": [
      79.57,
      19.7,
      5.36
    ],
    "numSets": 81
  },
  {
    "code": 11,
    "name": "Light Turquoise",
    "hex": "#55A5AF",
    "lab": [
      63.29,
      -21.68,
      -12.71
    ],
    "numSets": 78
  },
  {
    "code": 1146,
    "name": "Warm Pink",
    "hex": "#F6B7BF",
    "lab": [
      80.31,
      23.92,
      4.92
    ],
    "numSets": 70
  },
  {
    "code": 89,
    "name": "Royal Blue",
    "hex": "#4C61DB",
    "lab": [
      45.9,
      30.75,
      -64.96
    ],
    "numSets": 68
  },
  {
    "code": 1065,
    "name": "Reddish Gold",
    "hex": "#AC8247",
    "lab": [
      57.26,
      9.35,
      37.78
    ],
    "numSets": 68
  },
  {
    "code": 1137,
    "name": "Sienna Brown",
    "hex": "#915C3C",
    "lab": [
      44.24,
      18.28,
      27.25
    ],
    "numSets": 65
  },
  {
    "code": 232,
    "name": "Sky Blue",
    "hex": "#7DBFDD",
    "lab": [
      74.09,
      -13.19,
      -21.56
    ],
    "numSets": 62
  },
  {
    "code": 112,
    "name": "Medium Bluish Violet",
    "hex": "#6874CA",
    "lab": [
      51.49,
      18.9,
      -46.2
    ],
    "numSets": 54
  },
  {
    "code": 335,
    "name": "Sand Red",
    "hex": "#D67572",
    "lab": [
      60.1,
      37.49,
      18.65
    ],
    "numSets": 51
  },
  {
    "code": 503,
    "name": "Very Light Gray",
    "hex": "#E6E3DA",
    "lab": [
      90.24,
      -0.55,
      4.75
    ],
    "numSets": 51
  },
  {
    "code": 125,
    "name": "Light Orange",
    "hex": "#F9BA61",
    "lab": [
      79.68,
      13.57,
      53.13
    ],
    "numSets": 46
  },
  {
    "code": 134,
    "name": "Copper",
    "hex": "#AE7A59",
    "lab": [
      55.73,
      16.32,
      26.12
    ],
    "numSets": 45
  },
  {
    "code": 69,
    "name": "Light Purple",
    "hex": "#CD6298",
    "lab": [
      56.07,
      48.45,
      -9.36
    ],
    "numSets": 38
  },
  {
    "code": 9,
    "name": "Light Blue",
    "hex": "#B4D2E3",
    "lab": [
      82.56,
      -6.34,
      -11.7
    ],
    "numSets": 34
  },
  {
    "code": 1135,
    "name": "Metal",
    "hex": "#A5ADB4",
    "lab": [
      70.3,
      -1.41,
      -4.55
    ],
    "numSets": 29
  },
  {
    "code": 1007,
    "name": "Reddish Lilac",
    "hex": "#8E5597",
    "lab": [
      44.92,
      34.77,
      -26.56
    ],
    "numSets": 23
  },
  {
    "code": 120,
    "name": "Light Lime",
    "hex": "#D9E4A7",
    "lab": [
      88.46,
      -13.55,
      28.62
    ],
    "numSets": 21
  },
  {
    "code": 373,
    "name": "Sand Purple",
    "hex": "#845E84",
    "lab": [
      45.05,
      22.29,
      -15.06
    ],
    "numSets": 21
  },
  {
    "code": 1091,
    "name": "Warm Yellowish Orange",
    "hex": "#FFCB78",
    "lab": [
      84.65,
      8.88,
      48.05
    ],
    "numSets": 19
  },
  {
    "code": 1093,
    "name": "Light Lilac",
    "hex": "#9195CA",
    "lab": [
      63.16,
      10.51,
      -27.72
    ],
    "numSets": 19
  },
  {
    "code": 1138,
    "name": "Umber Brown",
    "hex": "#5E3F33",
    "lab": [
      29.85,
      11.88,
      12.81
    ],
    "numSets": 19
  },
  {
    "code": 216,
    "name": "Rust",
    "hex": "#B31004",
    "lab": [
      37.78,
      59.51,
      50.17
    ],
    "numSets": 17
  },
  {
    "code": 68,
    "name": "Very Light Orange",
    "hex": "#F3CF9B",
    "lab": [
      85.02,
      5.51,
      30.56
    ],
    "numSets": 16
  },
  {
    "code": 1141,
    "name": "Neon Green",
    "hex": "#D2FC43",
    "lab": [
      93.33,
      -36.69,
      78.37
    ],
    "numSets": 15
  },
  {
    "code": 1129,
    "name": "HO Olive Green",
    "hex": "#9B9A5A",
    "lab": [
      62.35,
      -9.38,
      33.67
    ],
    "numSets": 14
  },
  {
    "code": 1145,
    "name": "Ochre Yellow",
    "hex": "#DD9E47",
    "lab": [
      69.67,
      15.12,
      53.28
    ],
    "numSets": 14
  },
  {
    "code": 1001,
    "name": "Medium Violet",
    "hex": "#9391E4",
    "lab": [
      63.39,
      20.1,
      -41.82
    ],
    "numSets": 13
  },
  {
    "code": 1068,
    "name": "Bright Reddish Orange",
    "hex": "#EE5434",
    "lab": [
      56.85,
      57.7,
      49.61
    ],
    "numSets": 13
  },
  {
    "code": 1110,
    "name": "HO Dark Gray",
    "hex": "#6D6E5C",
    "lab": [
      45.87,
      -3.81,
      9.93
    ],
    "numSets": 11
  },
  {
    "code": 1067,
    "name": "Dark Nougat",
    "hex": "#AD6140",
    "lab": [
      49.26,
      27.71,
      32
    ],
    "numSets": 10
  },
  {
    "code": 1113,
    "name": "HO Dark Red",
    "hex": "#631314",
    "lab": [
      20.71,
      35.22,
      21.64
    ],
    "numSets": 10
  },
  {
    "code": 23,
    "name": "Dark Blue-Violet",
    "hex": "#2032B0",
    "lab": [
      28.7,
      39.94,
      -68.13
    ],
    "numSets": 9
  },
  {
    "code": 1109,
    "name": "HO Dark Blue",
    "hex": "#0A3463",
    "lab": [
      21.66,
      5.67,
      -31.68
    ],
    "numSets": 9
  },
  {
    "code": 1009,
    "name": "Vintage Green",
    "hex": "#1E601E",
    "lab": [
      35.47,
      -35.1,
      30.76
    ],
    "numSets": 8
  },
  {
    "code": 1010,
    "name": "Vintage Red",
    "hex": "#CA1F08",
    "lab": [
      43.59,
      63.04,
      54.42
    ],
    "numSets": 8
  },
  {
    "code": 1066,
    "name": "Curry",
    "hex": "#DD982E",
    "lab": [
      68.04,
      17.2,
      62.06
    ],
    "numSets": 6
  },
  {
    "code": 1074,
    "name": "Duplo Blue",
    "hex": "#009ECE",
    "lab": [
      60.7,
      -17.39,
      -34.18
    ],
    "numSets": 6
  },
  {
    "code": 1140,
    "name": "Neon Orange",
    "hex": "#EC4612",
    "lab": [
      54.3,
      61.7,
      61.31
    ],
    "numSets": 5
  }
];

/**
 * Converts sRGB [0..255] to CIE L*a*b* (D65 reference white)
 */
export function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  let rL = r / 255;
  let gL = g / 255;
  let bL = b / 255;

  rL = rL > 0.04045 ? Math.pow((rL + 0.055) / 1.055, 2.4) : rL / 12.92;
  gL = gL > 0.04045 ? Math.pow((gL + 0.055) / 1.055, 2.4) : gL / 12.92;
  bL = bL > 0.04045 ? Math.pow((bL + 0.055) / 1.055, 2.4) : bL / 12.92;

  // D65 reference white: Xn = 0.95047, Yn = 1.00000, Zn = 1.08883
  const x = (rL * 0.4124564 + gL * 0.3575761 + bL * 0.1804375) / 0.95047;
  const y = (rL * 0.2126729 + gL * 0.7151522 + bL * 0.0721750) / 1.00000;
  const z = (rL * 0.0193339 + gL * 0.1191920 + bL * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856451679 ? Math.cbrt(t) : 7.787037037 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  const L = Math.max(0, 116 * fy - 16);
  const a = 500 * (fx - fy);
  const bVal = 200 * (fy - fz);

  return [L, a, bVal];
}

/**
 * Standard CIEDE2000 (Delta E 00) perceptual color distance.
 * Implements ISO/CIE 11664-6 / Sharma et al. (2005) standard.
 */
export function ciede2000(lab1: [number, number, number], lab2: [number, number, number]): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const Cbar = (C1 + C2) / 2;

  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 6103515625))); // 25^7 = 6103515625

  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);

  const rad2deg = 180 / Math.PI;
  const deg2rad = Math.PI / 180;

  let h1p = Math.atan2(b1, a1p) * rad2deg;
  if (h1p < 0) h1p += 360;

  let h2p = Math.atan2(b2, a2p) * rad2deg;
  if (h2p < 0) h2p += 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    const diff = h2p - h1p;
    if (Math.abs(diff) <= 180) {
      dhp = diff;
    } else if (diff > 180) {
      dhp = diff - 360;
    } else {
      dhp = diff + 360;
    }
  }

  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * deg2rad) / 2);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp = 0;
  if (C1p * C2p !== 0) {
    const diff = Math.abs(h1p - h2p);
    if (diff <= 180) {
      hbarp = (h1p + h2p) / 2;
    } else if (h1p + h2p < 360) {
      hbarp = (h1p + h2p + 360) / 2;
    } else {
      hbarp = (h1p + h2p - 360) / 2;
    }
  } else {
    hbarp = h1p + h2p;
  }

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * deg2rad) +
    0.24 * Math.cos(2 * hbarp * deg2rad) +
    0.32 * Math.cos((3 * hbarp + 6) * deg2rad) -
    0.2 * Math.cos((4 * hbarp - 63) * deg2rad);

  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const RC = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 6103515625));

  const SL = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;

  const RT = -Math.sin(2 * dTheta * deg2rad) * RC;

  const dL_SL = dLp / SL;
  const dC_SC = dCp / SC;
  const dH_SH = dHp / SH;

  const dE2 = dL_SL * dL_SL + dC_SC * dC_SC + dH_SH * dH_SH + RT * dC_SC * dH_SH;
  return Math.sqrt(Math.max(0, dE2));
}

/**
 * Matches an RGB color against the official LEGO solid color palette.
 */
export function matchOfficialLegoColor(rgb: [number, number, number]): InferredColor {
  const [r, g, b] = rgb;
  const sampleLab = rgbToLab(r, g, b);
  const sampleHex =
    '#' +
    [r, g, b]
      .map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();

  let bestColor = LEGO_SOLID_PALETTE[0];
  let minDeltaE = Infinity;

  for (const c of LEGO_SOLID_PALETTE) {
    const dE = ciede2000(sampleLab, c.lab);
    // Popularity weighting when distance is very close (tie-breaker for rare vintage vs common modern)
    const popularityBonus = Math.min(0.8, (Math.log10(Math.max(10, c.numSets)) - 1) * 0.2);
    const score = dE - popularityBonus;

    if (score < minDeltaE) {
      minDeltaE = score;
      bestColor = c;
    }
  }

  // Exact distance to the chosen color
  const actualDeltaE = ciede2000(sampleLab, bestColor.lab);

  return {
    code: bestColor.code,
    name: bestColor.name,
    hex: bestColor.hex,
    deltaE: Math.round(actualDeltaE * 100) / 100,
    sampleHex
  };
}

/**
 * Extracts diffuse RGB from an image canvas under a region's polygon/bounding box,
 * rejecting specular highlights and deep shadow crevices.
 */
export function extractRegionColor(
  source: CanvasImageSource,
  box: BoundingBox,
  polygon?: Point2D[]
): InferredColor {
  const bw = Math.max(1, Math.round(box.w));
  const bh = Math.max(1, Math.round(box.h));

  const canvas = document.createElement('canvas');
  canvas.width = bw;
  canvas.height = bh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  if (!ctx) {
    return {
      code: 0,
      name: 'Black',
      hex: '#05131D',
      deltaE: 99,
      sampleHex: '#000000'
    };
  }

  if (polygon && polygon.length >= 3) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < polygon.length; i++) {
      const px = polygon[i].x - box.x;
      const py = polygon[i].y - box.y;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(source, box.x, box.y, bw, bh, 0, 0, bw, bh);
    ctx.restore();
  } else {
    // Inner 70% inset box to avoid edge shadows / background bleed
    const mx = Math.round(bw * 0.15);
    const my = Math.round(bh * 0.15);
    const sw = Math.max(1, bw - 2 * mx);
    const sh = Math.max(1, bh - 2 * my);
    ctx.drawImage(source, box.x + mx, box.y + my, sw, sh, 0, 0, bw, bh);
  }

  const imgData = ctx.getImageData(0, 0, bw, bh).data;
  const totalPixels = bw * bh;

  const rVals: number[] = [];
  const gVals: number[] = [];
  const bVals: number[] = [];

  const fallbackRVals: number[] = [];
  const fallbackGVals: number[] = [];
  const fallbackBVals: number[] = [];

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const a = imgData[idx + 3];
    if (a < 128) continue; // Outside polygon mask

    const r = imgData[idx];
    const g = imgData[idx + 1];
    const b = imgData[idx + 2];

    fallbackRVals.push(r);
    fallbackGVals.push(g);
    fallbackBVals.push(b);

    const lum = 0.2126 * (r / 255) + 0.7152 * (g / 255) + 0.0722 * (b / 255);

    // Gating: Discard specular white glare (> 0.92) and crevice dark shadows (< 0.06)
    if (lum >= 0.06 && lum <= 0.92) {
      rVals.push(r);
      gVals.push(g);
      bVals.push(b);
    }
  }

  const targetR = rVals.length >= 10 ? rVals : fallbackRVals;
  const targetG = gVals.length >= 10 ? gVals : fallbackGVals;
  const targetB = bVals.length >= 10 ? bVals : fallbackBVals;

  if (targetR.length === 0) {
    return {
      code: 0,
      name: 'Black',
      hex: '#05131D',
      deltaE: 99,
      sampleHex: '#000000'
    };
  }

  // Median values
  targetR.sort((a, b) => a - b);
  targetG.sort((a, b) => a - b);
  targetB.sort((a, b) => a - b);

  const mid = Math.floor(targetR.length / 2);
  const medR = targetR[mid];
  const medG = targetG[mid];
  const medB = targetB[mid];

  return matchOfficialLegoColor([medR, medG, medB]);
}

/**
 * Infers official LEGO colors for a list of detected regions from the image source.
 */
export function inferColorsForRegions(
  source: CanvasImageSource,
  regions: DetectedRegion[]
): DetectedRegion[] {
  return regions.map((region) => {
    try {
      const colorInfo = extractRegionColor(source, region.box, region.polygon);
      return {
        ...region,
        colorInfo
      };
    } catch (err) {
      console.warn('Color inference error for piece #' + region.id, err);
      return region;
    }
  });
}
