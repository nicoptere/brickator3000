# BrickPack SDF Documentation

Welcome to the technical documentation for **BrickPack SDF**, covering both the focused optimal algorithm paper and the complete historical monograph of the Brickator3000 research series.

## Table of Contents

1. **Papers & Technical Monographs**
   - [BrickPack SDF — Focused Algorithm Paper (PDF)](./BRICKPACK-short.pdf) · [LaTeX Source](./BRICKPACK-short.tex)
     - Concise 4–5 page technical paper presenting only the final winning SDF representation, Barnes–Hut Generalized Winding sign, $4\text{ LDU}$ box-filtered coverage, $\mathrm{EDT}^2$ + stud CSG catalog construction, Dinkelbach level-set shift, Summed-Area Table + sparse boundary deficits, LNS search, stud bridging, and benchmark results.
   - [Brickator3000 Full Technical Report — Light Edition (3.7 MB PDF)](./BRICKATOR3000-light.pdf)
     - Complete 47-page monograph (Part I: Early heuristic & Markov/WFC avenues; Part II: Constructive `Brickagen`; Part III: `BrickPack` SDF optimization; Part IV: Interactive gallery & full 30-run evaluation) compressed for fast web viewing.
   - [Brickator3000 Full Technical Report — Print / High-Res Edition (24 MB PDF)](./BRICKATOR3000-merged.pdf)
     - Full archival resolution monograph with embedded interactive U3D/PRC figures.

2. **Codebase & Dataset Guides**
   - [Main Project Overview](../README.md)
   - [Python Package & Scripts (`python/`)](../python/README.md)
   - [Node.js CLI & WebGPU / WebGL App (`js/`)](../js/README.md)
   - [Dataset Attribution & LDraw 99 Catalog Spec](../dataset/ATTRIBUTION.md)

---

## Core References

- **Generalized Winding Numbers (GWN) & Barnes–Hut Acceleration**
  - Jacobson, A., Kavan, L., & Sorkine-Hornung, O. (2013). *Robust Inside-Outside Segmentation using Generalized Winding Numbers*. ACM Transactions on Graphics (SIGGRAPH).
  - Barill, G., Dickson, N., Schmidt, R., Levin, D. I. W., & Jacobson, A. (2018). *Fast Winding Numbers for Soups and Clouds*. ACM Transactions on Graphics (SIGGRAPH).
- **Exact Squared Euclidean Distance Transform ($\mathrm{EDT}^2$)**
  - Felzenszwalb, P. F., & Huttenlocher, D. P. (2012). *Distance Transforms of Sampled Functions*. Theory of Computing, 8(1), 415–428.
- **Fractional Soft-IoU Linearization**
  - Dinkelbach, W. (1967). *On Nonlinear Fractional Programming*. Management Science, 13(7), 492–498.
- **Point-to-Triangle Exact Narrow-Band Distance**
  - Ericson, C. (2004). *Real-Time Collision Detection* (§5.1.5 Closest Point on Triangle to Point). Morgan Kaufmann.
- **Large Neighbourhood Search (Ruin-and-Recreate)**
  - Shaw, P. (1998). *Using Constraint Programming and Local Search Methods to Solve Vehicle Routing Problems*. CP '98.
  - Schrimpf, G., Schneider, J., Stamm-Wilbrandt, H., & Dueck, G. (2000). *Record Breaking Optimization Results Using the Ruin and Recreate Principle*. Journal of Computational Physics.
- **Perceptual Color Matching (Official LDraw Palette)**
  - Sharma, G., Wu, W., & Dalal, E. N. (2005). *The CIEDE2000 Color-Difference Formula: Implementation Notes, Supplementary Test Data, and Mathematical Observations*. Color Research & Application.
- **LDraw Parts Library & Color Specification**
  - LDraw Standards Committee. *LDraw.org Official Library & `LDConfig.ldr`*. https://www.ldraw.org/
