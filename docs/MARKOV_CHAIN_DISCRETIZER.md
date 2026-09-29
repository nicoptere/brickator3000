# Markov Junior & Graph Connector Architecture for LEGO Discretization

## 1. Overview & Theoretical Foundation

This architecture integrates the probabilistic rewrite and constraint propagation principles of **MarkovJunior** ([mxgmn/MarkovJunior](https://github.com/mxgmn/MarkovJunior/)) into 3D LEGO voxel space discretization.

Rather than relying purely on greedy 1D/2D rasterization, the voxel space is modeled as a **Constraint Graph**, and every LEGO element in the LDraw catalog acts as a **Connector Hyperedge** that binds 2 or more voxel cells into a rigid, physically sound component.

Local documentation and repository source are preserved under `docs/MarkovJunior/`.

---

## 2. Voxel Space as a Graph Problem

Let the 3D voxel grid be represented as an undirected graph $G = (V, E)$:
- **Vertices $V$**: Each occupied voxel cell $v = (x, z, y)$ in the discretized bounding box.
  - Stud dimensions: $X, Z$ with pitch $20 \text{ LDU}$.
  - Plate height: $Y$ with pitch $8 \text{ LDU}$ ($3 \text{ plates} = 1 \text{ standard brick} = 24 \text{ LDU}$).
  - Vertex attributes:
    $$v = (\text{occupied}, \text{colorCode}, \vec{n}, \theta_{\text{slope}}, \vec{h}_{\text{heading}}, \kappa_1, \kappa_2, \text{role})$$
- **Edges $E$**:
  - **Horizontal Adjacency Edges**: $(x, z, y) \leftrightarrow (x \pm 1, z, y)$ and $(x, z, y) \leftrightarrow (x, z \pm 1, y)$ representing lateral contact within the same plate layer.
  - **Vertical Clutch Edges**: $(x, z, y) \leftrightarrow (x, z, y \pm 1)$ representing stud-to-tube/anti-stud clutch force across vertical layers.

### Graph Partitioning via Connectors
A LEGO element (brick, plate, slope, tile, technic piece) placed at grid origin $(x_0, z_0, y_0)$ covers a local subgraph of cells:
$$V(C) = \{ (x_0 + \Delta x, z_0 + \Delta z, y_0 + \Delta y) \mid (\Delta x, \Delta z, \Delta y) \in \text{footprint}(C) \}$$

The goal of the Markov Junior solver is to find a disjoint covering $\{ C_1, C_2, \dots, C_k \}$ such that:
1. **Non-overlapping**: $V(C_i) \cap V(C_j) = \emptyset$ for $i \ne j$.
2. **Complete Coverage**: $\bigcup_{i} V(C_i) = V$.
3. **Color Uniformity**: For all $v \in V(C_i)$, $\text{color}(v) = \text{color}(C_i)$.
4. **Interlocking Running Bond**: Seams between adjacent connectors in layer $y$ are bridged by overlapping connectors in layers $y-1$ and $y+1$.
5. **Physical Grounding**: Every component has a continuous clutch-edge path down to the ground plane ($y=0$ in world coordinates).

---

## 3. The Connector Database (`LEAF`, `EDGE`, `FILL`, `EMPTY`)

All LDraw parts are indexed in `ConnectorDatabase` (`generator/src/discretizer/connectorDatabase.ts`) and partitioned into four core roles:

| Category | Role in Graph | Examples & LDraw IDs | Degree / Connectivity |
| :--- | :--- | :--- | :--- |
| **`LEAF`** | Terminal nodes, extremities, fine detail, crests, apexes | `54200` (1x1 cheese), `85984` (1x2 cheese), `4589` (1x1 cone), `4740` (2x2 radar dish), `41669` (Bionicle tooth/spine), `53451` (barb/horn), `6141` (1x1 round plate), `98138` (1x1 round tile), `3005` (1x1 unit brick) | Low degree (1–4 cells). Caps or terminates graph branches. |
| **`EDGE`** | Surface boundary contours, exterior slopes, corners, hull perimeters | `11477` (2x1 curved slope), `15068` (2x2 curved slope), `61678` (4x1 curved slope), `88930` (4x2 curved slope), `93273` / `24201` (inverted slopes), `3040`–`3037` (45° slopes), `27925` (2x2 macaroni), `25269` (1x1 quarter round), `2431` / `3068b` (studless flat tiles) | Medium degree (2–12 cells). Directs surface normals and seals boundary interface. |
| **`FILL`** | Bulk interior structural mass, high-degree graph spine | `3007` (2x8 brick), `2456` (2x6 brick), `3001` (2x4 brick), `3002` (2x3 brick), `3003` (2x2 brick), `3008`–`3004` (1xN bricks), `3034`–`3020` (multi-stud plates), `3700`–`3702` (Technic chassis bricks) | High degree (4–48 cells). Provides maximum clutch strength and staggered running bond interlocking. |
| **`EMPTY`** | Void constraints, air, carved pockets, negative space | `EMPTY_AIR` (exterior air), `EMPTY_CAVITY` (hollow core), `EMPTY_WHEEL_WELL` (1-stud wheel clearance pocket), `EMPTY_WINDOW` (openings) | Degree 0. Constrains where solid connectors must NOT penetrate. |

---

## 4. Multi-Resolution Hierarchical Scanning

To accelerate constraint propagation and prevent combinatorial explosion, voxel space is scanned across descending resolution tiers (`generator/src/discretizer/multiResolutionScanner.ts`):

```
+--------------------------------------------------------------+
| Level 2 (Coarse): 4x4 studs x 1 brick (3 plates)            |
| -> Identifies FULL_SOLID bulk blocks, FULL_EMPTY voids       |
+--------------------------------------------------------------+
                               |
                               v
+--------------------------------------------------------------+
| Level 1 (Medium): 2x2 studs x 1 plate                        |
| -> Refines BOUNDARY blocks, groups sub-clusters              |
+--------------------------------------------------------------+
                               |
                               v
+--------------------------------------------------------------+
| Level 0 (Unit Size): 1x1 stud x 1 plate                      |
| -> Resolves remaining boundary cells into EDGE & LEAF pieces |
+--------------------------------------------------------------+
```

1. **Coarse Scan**: Blocks with occupancy $\rho \ge 0.99$ are designated `FULL_SOLID`, directly pre-allocating candidates for large `FILL` pieces (`3007`, `3001`).
2. **Boundary Refinement**: Blocks with $0.01 < \rho < 0.99$ contain surface interfaces and are recursively subdivided down to unit resolution.
3. **Unit Matching**: At Level 0, boundary cells are evaluated using Lattice Slope Inference and Subgrid Curvature Inference to assign precise `EDGE` and `LEAF` connectors.

---

## 5. Lattice Slope & Subgrid Curvature Inference

### A. Lattice Slope Inference (`LatticeSlopeAnalyzer`)
The 3D voxel lattice coordinates are analyzed directly to detect height step ratios across layers:
- **Lattice Gradient Vector**:
  $$\nabla V = \left( \frac{V(x+1) - V(x-1)}{2}, \frac{V(z+1) - V(z-1)}{2}, \frac{V(y+1) - V(y-1)}{2} \right)$$
- **Step Ratio**: Vertical plate differential $\Delta y$ (8 LDU) vs horizontal stud distance $\Delta r$ (20 LDU):
  - $3 \text{ plates (24 LDU)} / 1\text{–}2 \text{ studs (20–40 LDU)} \implies \theta \approx 31^\circ\text{–}50^\circ \implies$ **45° / 33° Slopes** (`3040`, `3039`).
  - $2 \text{ plates (16 LDU)} / 1 \text{ stud (20 LDU)} \implies \theta \approx 38^\circ \implies$ **Cheese Slopes** (`54200`, `85984`).
  - Inverted step (solid above, empty air underneath) $\implies$ **Inverted Slopes** (`93273`, `24201`).
- **Heading Alignment**:
  - $\Delta z > 0 \implies \text{Heading } 0^\circ$ (descends in $+Z$)
  - $\Delta z < 0 \implies \text{Heading } 180^\circ$ (descends in $-Z$)
  - $\Delta x < 0 \implies \text{Heading } 90^\circ$ (descends in $-X$)
  - $\Delta x > 0 \implies \text{Heading } 270^\circ$ (descends in $+X$)

### B. Cell Subgrid Curvature Inference (`SubgridCurvatureAnalyzer`)
Within each unit cell, a $4 \times 4$ micro-subgrid is evaluated to compute discrete second derivatives (Hessian matrix):
$$H = \begin{pmatrix} \frac{\partial^2 f}{\partial x^2} & \frac{\partial^2 f}{\partial x \partial z} \\ \frac{\partial^2 f}{\partial z \partial x} & \frac{\partial^2 f}{\partial z^2} \end{pmatrix}$$

The eigenvalues of $H$ yield principal curvatures $\kappa_1$ and $\kappa_2$:
- **Flat ($\kappa_1 \approx 0, \kappa_2 \approx 0$)**: Planar surface $\to$ Smooth flat tiles (`3068b`, `3069b`, `2431`) or standard plates.
- **Cylindrical Convex ($\kappa_1 > 0, \kappa_2 \approx 0$)**: Uniaxial curvature $\to$ Modern curved slopes (`11477`, `15068`, `61678`, `88930`).
- **Cylindrical Concave ($\kappa_1 < 0, \kappa_2 \approx 0$)**: Underside arch $\to$ Inverted curved slopes (`93273`, `24201`).
- **Spherical Dome ($\kappa_1 > 0, \kappa_2 > 0$)**: Hemispherical apex $\to$ Inverted radar dishes (`4740`, `43898`).
- **Corner Macaroni**: Curvature at perpendicular boundary edges $\to$ Macaroni tiles (`27925`) and quarter rounds (`25269`).
- **Sharp Cusp ($|\kappa_1| \gg \text{threshold}$)**: Organic crests, ridges, and spikes $\to$ Bionicle teeth / spines (`41669`, `53451`, `87747`).

---

## 6. Implementation Architecture

- **`generator/src/discretizer/connectorDatabase.ts`**: Central registry of all LDraw pieces categorized as `LEAF`, `EDGE`, `FILL`, `EMPTY`.
- **`generator/src/discretizer/latticeSlopeCurvature.ts`**: Mathematical engine for lattice slope extraction and subgrid Hessian curvature estimation.
- **`generator/src/discretizer/multiResolutionScanner.ts`**: Pyramid building and coarse-to-unit scanning.
- **`generator/src/discretizer/voxelGraph.ts`**: Graph data structures, adjacency linking, and Markov Junior constraint solver.
- **`generator/src/discretizer/discretizer.ts`**: Unified entrypoint supporting `enableMarkovGraph: true`.
- **`docs/MarkovJunior/`**: Local clone of the authoritative MarkovJunior reference implementation.
