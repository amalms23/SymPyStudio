/**
 * SymPyStudio — Visual CAS Notebook with Persistent Memory
 * Powered by Pyodide (WebAssembly Python + SymPy), MathLive, KaTeX, and Plotly.js
 */

const STORAGE_KEY = 'sympystudio_notebook_v2';            // legacy single-notebook key (migrated on load)
const WORKSPACE_STORAGE_KEY = 'sympystudio_workspace_v3'; // multi-tab workspace

// Global Application State
const AppState = {
  kernelReady: false,
  kernelBusy: false,
  tabs: [],              // [{ id, name, cells, symbolAssumptions, evalCounter, evaluated }]
  activeTabId: null,
  cells: [],             // always the cells array of the active tab
  activeCellId: null,
  evalCounter: 0,
  sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
  paletteOpen: true,
  ribbonOpen: true,
  symbolAssumptions: {}, // { symName: { positive, real, integer, nonzero } }
  codeMirrors: {},       // { cellId: CodeMirrorInstance }
  previewTimers: {},     // { cellId: timeoutId } for live code -> visual math preview
};

// Canonical Coordinate System Defaults & Shared Parameter Schemas
const COORD_SYSTEM_DEFAULTS = {
  cartesian: 'x, y, z',
  cylindrical: 'r, theta, z',
  spherical: 'r, theta, phi'
};

const CURVILINEAR_PARAMS = [
  {
    key: 'system',
    label: 'System',
    type: 'select',
    default: 'cartesian',
    options: [
      { value: 'cartesian', text: 'Cartesian (x, y, z)' },
      { value: 'cylindrical', text: 'Cylindrical (r, θ, z)' },
      { value: 'spherical', text: 'Spherical (r, θ, φ)' }
    ]
  },
  { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-24' }
];

// Backward-compatible operation aliases (collapses legacy duplicates into canonical operations)
const OPERATION_ALIASES = {
  vec_grad: 'curv_grad',
  vec_div: 'curv_div',
  vec_curl: 'curv_curl',
  vec_laplacian: 'curv_laplacian',
  em_field_plot: 'plot_vector_2d'
};

function normalizeOperationKey(opKey) {
  return OPERATION_ALIASES[opKey] || opKey || 'eval';
}

// Categorized Optgroup Labels for Ergonomic Cell Operation Dropdowns
const OPERATION_GROUPS = [
  { id: 'calc', label: '1. Calculus & Analysis' },
  { id: 'alg', label: '2. Algebra & Solvers' },
  { id: 'linalg', label: '3. Matrices & Vector Calculus' },
  { id: 'ode', label: '4. Differential Equations (ODE)' },
  { id: 'plot', label: '5. Function & Field Plotter' },
  { id: 'mech', label: '6A. Solid Mechanics Suite' },
  { id: 'em', label: '6B. Electrodynamics Suite' }
];

// Operation Metadata & Parameter Configurations
const OPERATIONS = {
  eval: {
    label: 'Evaluate / Symbolic Simplify',
    category: 'tab-calculus',
    group: 'calc',
    params: []
  },
  diff: {
    label: 'Differentiate (d/dx, ∂/∂x)',
    category: 'tab-calculus',
    group: 'calc',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-12' },
      { key: 'order', label: 'Order (n)', type: 'number', default: '1', width: 'w-12' }
    ]
  },
  integrate_indef: {
    label: 'Indefinite Integral (∫ f dx)',
    category: 'tab-calculus',
    group: 'calc',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-12' }
    ]
  },
  integrate_def: {
    label: 'Definite Integral (∫_a^b f dx)',
    category: 'tab-calculus',
    group: 'calc',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-12' },
      { key: 'lower', label: 'From (a)', type: 'text', default: '0', width: 'w-16' },
      { key: 'upper', label: 'To (b)', type: 'text', default: 'pi', width: 'w-16' }
    ]
  },
  limit: {
    label: 'Limit (lim x → a)',
    category: 'tab-calculus',
    group: 'calc',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-12' },
      { key: 'point', label: 'Approaches (a)', type: 'text', default: '0', width: 'w-16' },
      {
        key: 'dir',
        label: 'Direction',
        type: 'select',
        default: '+-',
        options: [
          { value: '+-', text: 'Two-sided (±)' },
          { value: '+', text: 'Right (a⁺)' },
          { value: '-', text: 'Left (a⁻)' }
        ]
      }
    ]
  },
  series: {
    label: 'Taylor / Maclaurin Series',
    category: 'tab-calculus',
    group: 'calc',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-12' },
      { key: 'point', label: 'Around (x₀)', type: 'text', default: '0', width: 'w-14' },
      { key: 'order', label: 'Order (n)', type: 'number', default: '6', width: 'w-12' }
    ]
  },
  sum: {
    label: 'Symbolic Summation (Σ)',
    category: 'tab-calculus',
    group: 'calc',
    params: [
      { key: 'var', label: 'Index', type: 'text', default: 'n', width: 'w-12' },
      { key: 'lower', label: 'From', type: 'text', default: '1', width: 'w-14' },
      { key: 'upper', label: 'To', type: 'text', default: 'oo', width: 'w-14' }
    ]
  },
  solve: {
    label: 'Solve Equation for Variable',
    category: 'tab-algebra',
    group: 'alg',
    params: [
      { key: 'var', label: 'Solve for', type: 'text', default: 'x', width: 'w-14' }
    ]
  },
  solve_system: {
    label: 'Simultaneous Equation Solver',
    category: 'tab-algebra',
    group: 'alg',
    params: [
      { key: 'eq2', label: '2nd Eq', type: 'text', default: 'x - y = 1', width: 'w-36' },
      { key: 'eq3', label: '3rd Eq (opt)', type: 'text', default: '', width: 'w-28' },
      { key: 'vars', label: 'Vars', type: 'text', default: 'x, y', width: 'w-20' }
    ]
  },
  simplify: {
    label: 'Simplify Expression',
    category: 'tab-algebra',
    group: 'alg',
    params: []
  },
  expand: {
    label: 'Expand Expression',
    category: 'tab-algebra',
    group: 'alg',
    params: []
  },
  factor: {
    label: 'Factor Polynomial / Expression',
    category: 'tab-algebra',
    group: 'alg',
    params: []
  },
  apart: {
    label: 'Partial Fractions (apart)',
    category: 'tab-algebra',
    group: 'alg',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-12' }
    ]
  },
  trigsimp: {
    label: 'Trigonometric Simplification',
    category: 'tab-algebra',
    group: 'alg',
    params: []
  },
  mat_det: {
    label: 'Matrix Determinant det(A)',
    category: 'tab-linalg',
    group: 'linalg',
    params: []
  },
  mat_inv: {
    label: 'Matrix Inverse (A⁻¹)',
    category: 'tab-linalg',
    group: 'linalg',
    params: []
  },
  mat_transpose: {
    label: 'Matrix Transpose (Aᵀ)',
    category: 'tab-linalg',
    group: 'linalg',
    params: []
  },
  mat_trace: {
    label: 'Matrix Trace tr(A)',
    category: 'tab-linalg',
    group: 'linalg',
    params: []
  },
  mat_charpoly: {
    label: 'Characteristic Polynomial p(λ)',
    category: 'tab-linalg',
    group: 'linalg',
    params: [
      { key: 'var', label: 'Symbol', type: 'text', default: 'lambda', width: 'w-16' }
    ]
  },
  mat_eigen: {
    label: 'Eigenvalues & Eigenvectors',
    category: 'tab-linalg',
    group: 'linalg',
    params: []
  },
  curv_grad: {
    label: 'Gradient (∇φ) — Cartesian / Curvilinear',
    category: 'tab-linalg',
    group: 'linalg',
    params: CURVILINEAR_PARAMS
  },
  curv_div: {
    label: 'Divergence (∇·F) — Cartesian / Curvilinear',
    category: 'tab-linalg',
    group: 'linalg',
    params: CURVILINEAR_PARAMS
  },
  curv_curl: {
    label: 'Curl (∇×F) — Cartesian / Curvilinear',
    category: 'tab-linalg',
    group: 'linalg',
    params: CURVILINEAR_PARAMS
  },
  curv_laplacian: {
    label: 'Laplacian (∇²φ) — Cartesian / Curvilinear',
    category: 'tab-linalg',
    group: 'linalg',
    params: CURVILINEAR_PARAMS
  },
  ode_solve: {
    label: 'ODE Symbolic Solver (sp.dsolve)',
    category: 'tab-ode',
    group: 'ode',
    params: [
      { key: 'func', label: 'Function', type: 'text', default: 'y(x)', width: 'w-14' },
      { key: 'ic1', label: 'IC 1 (e.g. y(0)=1)', type: 'text', default: '', width: 'w-24' },
      { key: 'ic2', label: "IC 2 (e.g. y'(0)=0)", type: 'text', default: '', width: 'w-24' }
    ]
  },
  plot_2d: {
    label: '2D Function Curves y = f(x)',
    category: 'tab-plotter',
    group: 'plot',
    params: [
      { key: 'var', label: 'Var', type: 'text', default: 'x', width: 'w-10' },
      { key: 'xmin', label: 'x_min', type: 'text', default: '-10', width: 'w-12' },
      { key: 'xmax', label: 'x_max', type: 'text', default: '10', width: 'w-12' },
      { key: 'overlay', label: 'Overlay f₂; f₃', type: 'text', default: '', width: 'w-28' },
      { key: 'labels', label: 'Labels', type: 'text', default: '', width: 'w-24' },
      { key: 'points', label: 'Samples', type: 'number', default: '400', width: 'w-14' }
    ]
  },
  plot_parametric: {
    label: '2D Parametric Curve x(t), y(t)',
    category: 'tab-plotter',
    group: 'plot',
    params: [
      { key: 'yt', label: 'y(t) (if scalar x)', type: 'text', default: 'sin(t)', width: 'w-28' },
      { key: 'var', label: 'Param', type: 'text', default: 't', width: 'w-10' },
      { key: 'tmin', label: 't_min', type: 'text', default: '0', width: 'w-12' },
      { key: 'tmax', label: 't_max', type: 'text', default: '2*pi', width: 'w-14' },
      { key: 'points', label: 'Samples', type: 'number', default: '400', width: 'w-14' }
    ]
  },
  plot_3d: {
    label: '3D Surface & Contours z = f(x, y)',
    category: 'tab-plotter',
    group: 'plot',
    params: [
      { key: 'xmin', label: 'x_min', type: 'text', default: '-5', width: 'w-12' },
      { key: 'xmax', label: 'x_max', type: 'text', default: '5', width: 'w-12' },
      { key: 'ymin', label: 'y_min', type: 'text', default: '-5', width: 'w-12' },
      { key: 'ymax', label: 'y_max', type: 'text', default: '5', width: 'w-12' }
    ]
  },
  plot_vector_2d: {
    label: '2D Vector Field Quiver [Fx, Fy] / ∇φ',
    category: 'tab-plotter',
    group: 'plot',
    params: [
      { key: 'xmin', label: 'x_min', type: 'text', default: '-4', width: 'w-12' },
      { key: 'xmax', label: 'x_max', type: 'text', default: '4', width: 'w-12' },
      { key: 'ymin', label: 'y_min', type: 'text', default: '-4', width: 'w-12' },
      { key: 'ymax', label: 'y_max', type: 'text', default: '4', width: 'w-12' },
      { key: 'grid', label: 'Grid N', type: 'number', default: '15', width: 'w-12' }
    ]
  },

  // --- SOLID MECHANICS SUITE ---
  mech_strain: {
    label: 'Small-Strain Tensor ε(u)',
    category: 'tab-suites',
    group: 'mech',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-20' }
    ]
  },
  mech_compat: {
    label: 'Saint-Venant Strain Compatibility',
    category: 'tab-suites',
    group: 'mech',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-20' }
    ]
  },
  mech_hooke: {
    label: "Constitutive Hooke's Law",
    category: 'tab-suites',
    group: 'mech',
    params: [
      {
        key: 'state',
        label: 'State',
        type: 'select',
        default: 'plane_stress',
        options: [
          { value: 'plane_stress', text: 'Plane Stress (2D)' },
          { value: 'plane_strain', text: 'Plane Strain (2D)' },
          { value: '3d', text: '3D Isotropic' }
        ]
      },
      {
        key: 'direction',
        label: 'Relation',
        type: 'select',
        default: 'strain_to_stress',
        options: [
          { value: 'strain_to_stress', text: 'Strain ε → Stress σ' },
          { value: 'stress_to_strain', text: 'Stress σ → Strain ε' }
        ]
      },
      { key: 'E', label: "Modulus (E)", type: 'text', default: 'E', width: 'w-12' },
      { key: 'nu', label: "Poisson (ν)", type: 'text', default: 'nu', width: 'w-12' }
    ]
  },
  mech_invariants: {
    label: 'Stress Invariants (I₁, J₂) & von Mises',
    category: 'tab-suites',
    group: 'mech',
    params: []
  },
  mech_airy: {
    label: 'Airy Stress Function Φ(x, y)',
    category: 'tab-suites',
    group: 'mech',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y', width: 'w-16' }
    ]
  },
  mech_mohr: {
    label: "Mohr's Circle Plot & Principal Stresses",
    category: 'tab-suites',
    group: 'mech',
    params: []
  },

  // --- ELECTRODYNAMICS SUITE ---
  em_maxwell_check: {
    label: "Maxwell's Equations Verifier",
    category: 'tab-suites',
    group: 'em',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-20' },
      { key: 'time', label: 'Time', type: 'text', default: 't', width: 'w-10' },
      { key: 'rho', label: 'Charge ρ', type: 'text', default: '0', width: 'w-14' },
      { key: 'J', label: 'Current J', type: 'text', default: '[0, 0, 0]', width: 'w-24' }
    ]
  },
  em_potentials: {
    label: 'Potentials (A, V) → Fields (E, B)',
    category: 'tab-suites',
    group: 'em',
    params: [
      { key: 'V', label: 'Scalar V', type: 'text', default: '0', width: 'w-24' },
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-18' },
      { key: 'time', label: 'Time', type: 'text', default: 't', width: 'w-10' }
    ]
  },
  em_gauge: {
    label: 'Lorenz & Coulomb Gauge Check',
    category: 'tab-suites',
    group: 'em',
    params: [
      { key: 'V', label: 'Scalar V', type: 'text', default: '0', width: 'w-24' },
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-18' },
      { key: 'time', label: 'Time', type: 'text', default: 't', width: 'w-10' },
      { key: 'c', label: 'Speed c', type: 'text', default: 'c', width: 'w-10' }
    ]
  },
  em_poynting: {
    label: 'Poynting Flux S = (1/μ₀)(E × B) & Energy u',
    category: 'tab-suites',
    group: 'em',
    params: []
  },
  em_stress_tensor: {
    label: 'Maxwell Stress Tensor T_ij & Force Density',
    category: 'tab-suites',
    group: 'em',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-18' }
    ]
  }
};

// Domain-Specific Template Vault & Physics Workflows
const PRESET_NOTEBOOKS = {
  // ==========================================================================
  // EMPTY NOTEBOOK (BLANK NOTE)
  // ==========================================================================
  blank: [
    { mode: 'visual', latex: '', operation: 'eval' }
  ],

  // ==========================================================================
  // SUITE 1: SOLID MECHANICS - CANTILEVER BEAM & AIRY STRESS (MOHR PLOT)
  // ==========================================================================
  suite_solid_cantilever: [
    {
      id: 'cell_sc_1',
      mode: 'visual',
      title: '1. Airy Stress Function for Tip-Loaded Cantilever Beam: Phi(x,y)',
      latex: String.raw`-\frac{P}{2 I} x y^2 + \frac{P}{6 I} y^3`,
      operation: 'mech_airy',
      params: { coords: 'x, y' },
      assignTo: 'sigma_beam'
    },
    {
      id: 'cell_sc_2',
      mode: 'code',
      title: '2. Cauchy Boundary Equilibrium & Bending Moment Verification',
      code: `# Given Airy stress tensor sigma_beam, verify stress components and bending moment
P_load, I_val, h_beam, L_beam = sp.symbols('P I h L', positive=True, real=True)
s_xx = -(P_load / I_val) * x * y
s_yy = sp.Integer(0)
tau_xy = (P_load / (2 * I_val)) * ( (h_beam/2)**2 - y**2 )

# Equilibrium in x: d(s_xx)/dx + d(tau_xy)/dy = 0
equil_x = sp.simplify(sp.diff(s_xx, x) + sp.diff(tau_xy, y))
print("Equilibrium d(sigma_xx)/dx + d(tau_xy)/dy:", equil_x)

# Integrated shear force along any cross-section x = const
V_res = sp.integrate(tau_xy, (y, -h_beam/2, h_beam/2))
print("Integrated Cross-Section Shear Force V(x):", sp.simplify(V_res.subs(I_val, h_beam**3 / 12)))`
    },
    {
      id: 'cell_sc_3',
      mode: 'visual',
      title: "3. Interactive Mohr's Circle at Clamped Root Surface (x=0, y=h/2)",
      latex: String.raw`[-120, 0, 45]`,
      operation: 'mech_mohr',
      params: {}
    }
  ],

  // ==========================================================================
  // SUITE 2: SOLID MECHANICS - LAME THICK CYLINDER & VON MISES YIELD
  // ==========================================================================
  suite_solid_pressurized_cylinder: [
    {
      id: 'cell_sp_1',
      mode: 'code',
      title: '1. Polar Navier Equation & Displacement Solution u(r)',
      code: `# Polar radial equilibrium: d^2 u / dr^2 + (1/r) du/dr - u/r^2 = 0
r_var = sp.Symbol('r', positive=True)
u_r = sp.Function('u')(r_var)
navier_eq = sp.Eq(sp.diff(u_r, r_var, 2) + (1/r_var)*sp.diff(u_r, r_var) - u_r/(r_var**2), 0)
gen_sol = sp.dsolve(navier_eq, u_r)
print("General Polar Displacement Solution:")
sp.pprint(gen_sol)`
    },
    {
      id: 'cell_sp_2',
      mode: 'code',
      title: '2. Lamé Equations for Pressurized Cylinder: sigma_r(r) and sigma_theta(r)',
      code: `# Pressurized thick tube: Inner radius a, Outer radius b, Internal pressure Pi
a_rad, b_rad, P_i = sp.symbols('a b P_i', positive=True)
# Lamé solutions for radial and hoop stresses
sig_r = (P_i * a_rad**2 / (b_rad**2 - a_rad**2)) * (1 - b_rad**2 / r_var**2)
sig_th = (P_i * a_rad**2 / (b_rad**2 - a_rad**2)) * (1 + b_rad**2 / r_var**2)

print("Radial Stress sigma_r(r):")
sp.pprint(sig_r)
print("\\nHoop Stress sigma_theta(r):")
sp.pprint(sig_th)`
    },
    {
      id: 'cell_sp_3',
      mode: 'visual',
      title: '3. Stress Invariants and von Mises Equivalent Yield Stress at Inner Bore (r = a)',
      latex: String.raw`\begin{bmatrix} -80 & 0 & 0 \\ 0 & 140 & 0 \\ 0 & 0 & 0 \end{bmatrix}`,
      operation: 'mech_invariants',
      params: {},
      assignTo: 'bore_yield'
    }
  ],

  // ==========================================================================
  // SUITE 3: SOLID MECHANICS - 3D YIELD CRITERIA & INVARIANTS (I1, J2)
  // ==========================================================================
  suite_solid_yield_criterion: [
    {
      id: 'cell_sy_1',
      mode: 'visual',
      title: '1. Triaxial General Stress Tensor: Invariants, Deviatoric S, and von Mises',
      latex: String.raw`\begin{bmatrix} 120 & -40 & 20 \\ -40 & 80 & 10 \\ 20 & 10 & -30 \end{bmatrix}`,
      operation: 'mech_invariants',
      params: {},
      assignTo: 'triaxial_stress'
    },
    {
      id: 'cell_sy_2',
      mode: 'visual',
      title: '2. Characteristic Polynomial p(sigma) for Principal Stresses',
      latex: String.raw`\begin{bmatrix} 120 & -40 & 20 \\ -40 & 80 & 10 \\ 20 & 10 & -30 \end{bmatrix}`,
      operation: 'mat_charpoly',
      params: { var: 'sigma' }
    },
    {
      id: 'cell_sy_3',
      mode: 'code',
      title: '3. Quantitative Yield Assessment: von Mises vs Tresca Max Shear',
      code: `# Given numerical stress matrix, compute exact eigenvalues and failure criteria
sig_mat = sp.Matrix([
    [120, -40,  20],
    [-40,  80,  10],
    [ 20,  10, -30]
])
# Eigenvalues (Principal stresses)
# (the cubic's exact roots carry ~1e-20 imaginary round-off when evaluated, so keep the real part)
p_stresses = sorted([float(sp.re(sp.N(v))) for v in sig_mat.eigenvals().keys()], reverse=True)
s1, s2, s3 = p_stresses[0], p_stresses[1], p_stresses[2]

tau_tresca = 0.5 * (s1 - s3)
sig_von_mises = math.sqrt(0.5 * ((s1 - s2)**2 + (s2 - s3)**2 + (s3 - s1)**2))

print(f"Principal Stresses: sigma_1 = {s1:.2f} MPa, sigma_2 = {s2:.2f} MPa, sigma_3 = {s3:.2f} MPa")
print(f"Tresca Maximum Shear Stress: tau_max = {tau_tresca:.2f} MPa")
print(f"von Mises Equivalent Stress: sigma_vm = {sig_von_mises:.2f} MPa")`
    }
  ],

  // ==========================================================================
  // SUITE 4: ELECTRODYNAMICS - RADIATING ELECTRIC & MAGNETIC DIPOLES
  // ==========================================================================
  suite_em_dipole: [
    {
      id: 'cell_ed_1',
      mode: 'visual',
      title: '1. Electric Dipole Potential V(r, theta) in Spherical Coordinates',
      latex: String.raw`\frac{p \cos(\theta)}{4 \pi \varepsilon_0 r^2}`,
      operation: 'curv_grad',
      params: { system: 'spherical', coords: 'r, theta, phi' },
      assignTo: 'grad_V_sph'
    },
    {
      id: 'cell_ed_2',
      mode: 'code',
      title: '2. Electric Field Components and Divergence Verification (r > 0)',
      code: `# Electric field in spherical coordinates: E = -grad(V)
p_dipole, eps0 = sp.symbols('p epsilon_0', positive=True)
E_r = (2 * p_dipole * sp.cos(theta)) / (4 * sp.pi * eps0 * r**3)
E_th = (p_dipole * sp.sin(theta)) / (4 * sp.pi * eps0 * r**3)
E_phi = sp.Integer(0)

# Spherical divergence: (1/r^2)*d(r^2 E_r)/dr + (1/(r sin theta))*d(sin theta E_th)/dtheta
div_E = (1 / r**2) * sp.diff(r**2 * E_r, r) + (1 / (r * sp.sin(theta))) * sp.diff(sp.sin(theta) * E_th, theta)
print("Spherical Divergence div(E) outside origin:")
sp.pprint(sp.simplify(div_E))`
    },
    {
      id: 'cell_ed_3',
      mode: 'visual',
      title: '3. 2D Electric Dipole Vector Field Quiver Plot in Cartesian Plane',
      latex: String.raw`\left[ \frac{3 x y}{(x^2 + y^2 + 0.1)^{5/2}}, \frac{2 y^2 - x^2}{(x^2 + y^2 + 0.1)^{5/2}} \right]`,
      operation: 'plot_vector_2d',
      params: { xmin: '-3', xmax: '3', ymin: '-3', ymax: '3', grid: 16 }
    }
  ],

  // ==========================================================================
  // SUITE 5: ELECTRODYNAMICS - EM PLANE WAVE, LORENZ GAUGE & POYNTING FLUX
  // ==========================================================================
  suite_em_maxwell_wave: [
    {
      id: 'cell_ew_1',
      mode: 'visual',
      title: '1. Verification of all 4 Maxwell Equations for Propagating TEM Plane Wave',
      latex: String.raw`\left[ [E_0 \cos(k z - \omega t), 0, 0], [0, \frac{E_0}{c} \cos(k z - \omega t), 0] \right]`,
      operation: 'em_maxwell_check',
      params: { coords: 'x, y, z', time: 't', rho: '0', J: '[0, 0, 0]' }
    },
    {
      id: 'cell_ew_2',
      mode: 'visual',
      title: '2. Vector Potential A and Lorenz Gauge Condition Check',
      latex: String.raw`\left[ -\frac{E_0}{\omega} \sin(k z - \omega t), 0, 0 \right]`,
      operation: 'em_gauge',
      params: { V: '0', coords: 'x, y, z', time: 't', c: 'c' }
    },
    {
      id: 'cell_ew_3',
      mode: 'visual',
      title: '3. Poynting Energy Flux Vector S and Electromagnetic Energy Density u',
      latex: String.raw`\left[ [E_0 \cos(k z - \omega t), 0, 0], [0, \frac{E_0}{c} \cos(k z - \omega t), 0] \right]`,
      operation: 'em_poynting',
      params: {},
      assignTo: 'S_wave'
    }
  ],

  // ==========================================================================
  // SUITE 6: ELECTRODYNAMICS - WAVEGUIDE TE10 MODES & MAXWELL STRESS
  // ==========================================================================
  suite_em_waveguide: [
    {
      id: 'cell_wg_1',
      mode: 'code',
      title: '1. Rectangular Waveguide TE10 Mode Dispersion and Cutoff Frequency',
      code: `# Rectangular waveguide dimensions: width a, height b
a_dim, b_dim, omega_freq, c_spd = sp.symbols('a b omega c', positive=True)
m_mode, n_mode = 1, 0  # TE10 mode

# Cutoff frequency omega_c
omega_cutoff = c_spd * sp.pi * sp.sqrt((m_mode/a_dim)**2 + (n_mode/b_dim)**2)
# Propagation constant beta
beta_prop = sp.sqrt((omega_freq/c_spd)**2 - (sp.pi/a_dim)**2)

print("TE10 Mode Cutoff Angular Frequency omega_c:")
sp.pprint(omega_cutoff)
print("\\nPropagation Constant beta(omega):")
sp.pprint(beta_prop)`
    },
    {
      id: 'cell_wg_2',
      mode: 'visual',
      title: '2. Maxwell Stress Tensor T_ij on Waveguide Boundary Wall',
      latex: String.raw`\left[ [0, E_0 \sin(\frac{\pi x}{a}) \cos(\omega t - \beta z), 0], [-\frac{\beta}{\omega} E_0 \sin(\frac{\pi x}{a}) \cos(\omega t - \beta z), 0, \frac{\pi}{\omega a} E_0 \cos(\frac{\pi x}{a}) \sin(\omega t - \beta z)] \right]`,
      operation: 'em_stress_tensor',
      params: { coords: 'x, y, z' }
    },
    {
      id: 'cell_wg_3',
      mode: 'visual',
      title: '3. Waveguide Electric Field Streamlines & Quiver in Cross-Section',
      latex: String.raw`\left[ 0, \sin(\frac{\pi x}{2}) \cos(z) \right]`,
      operation: 'plot_vector_2d',
      params: { xmin: '0', xmax: '2', ymin: '-3', ymax: '3', grid: 15 }
    }
  ],

  // ==========================================================================
  // TEMPLATE 1: SOLID MECHANICS & 2D ELASTICITY
  // ==========================================================================
  elasticity_2d: [
    {
      id: 'cell_elas_1',
      mode: 'code',
      title: '1. Plane Stress & Plane Strain Constitutive Stiffness Matrix [C] in Voigt Form',
      code: `# Define isotropic elastic constants: Young's Modulus E and Poisson's Ratio nu
E_mod, nu = sp.symbols('E nu', positive=True, real=True)

# Plane Stress Constitutive Matrix [C_stress] relating [sigma_xx, sigma_yy, tau_xy]^T = [C] * [eps_xx, eps_yy, gamma_xy]^T
C_stress = (E_mod / (1 - nu**2)) * sp.Matrix([
    [1,  nu, 0],
    [nu, 1,  0],
    [0,  0,  (1 - nu) / 2]
])

# Plane Strain Constitutive Matrix [C_strain]
C_strain = (E_mod / ((1 + nu) * (1 - 2*nu))) * sp.Matrix([
    [1 - nu, nu,     0],
    [nu,     1 - nu, 0],
    [0,      0,      (1 - 2*nu) / 2]
])

print("Plane Stress Stiffness Matrix [C_stress]:")
sp.pprint(C_stress)
print("\\nPlane Strain Stiffness Matrix [C_strain]:")
sp.pprint(C_strain)

result = C_stress`,
      assignTo: 'C_stress',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_elas_2',
      mode: 'code',
      title: '2. Airy Stress Function Φ(x, y) & Biharmonic Compatibility Check (∇⁴Φ = 0)',
      code: `# 2D Cantilever Beam of length L, depth 2c, unit thickness under tip shear load P at x = 0:
x, y = sp.symbols('x y', real=True)
P, c, I_zz = sp.symbols('P c I', positive=True, real=True)

# Airy Stress Potential: Phi(x, y) = -(3*P / (4*c)) * x * y + (P / (4*c**3)) * x * y**3
Phi = -(3 * P / (4 * c)) * x * y + (P / (4 * c**3)) * x * y**3

# Biharmonic compatibility operator: nabla^4(Phi) = d4Phi/dx4 + 2*d4Phi/(dx2 dy2) + d4Phi/dy4
biharmonic_Phi = sp.simplify(sp.diff(Phi, x, 4) + 2 * sp.diff(Phi, x, 2, y, 2) + sp.diff(Phi, y, 4))

print("Airy Stress Function Phi(x, y):")
sp.pprint(Phi)
print(f"\\nBiharmonic Compatibility Check (nabla^4 Phi == 0): {biharmonic_Phi} (Identically Satisfied!)")

result = Phi`,
      assignTo: 'Phi_Airy',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_elas_3',
      mode: 'code',
      title: '3. Cauchy Stress Tensor Components (σ_xx, σ_yy, τ_xy) Derived from Airy Potential',
      code: `# Derive 2D Cauchy stress components from Airy Stress Function Phi(x, y):
# sigma_xx = d^2(Phi)/dy^2,  sigma_yy = d^2(Phi)/dx^2,  tau_xy = -d^2(Phi)/(dx dy)
sigma_xx = sp.simplify(sp.diff(Phi, y, 2))
sigma_yy = sp.simplify(sp.diff(Phi, x, 2))
tau_xy   = sp.simplify(-sp.diff(Phi, x, y))

# Substitute second moment of area I = (2*c)^3 / 12 = 2*c^3 / 3  =>  c^3 = 3*I / 2
sigma_tensor = sp.Matrix([
    [sigma_xx.subs(c**3, 3*I_zz/2), tau_xy.subs(c**3, 3*I_zz/2)],
    [tau_xy.subs(c**3, 3*I_zz/2),   sigma_yy]
])

print("Bending Normal Stress sigma_xx(x, y) = P*x*y / I:")
sp.pprint(sigma_tensor[0, 0])
print("\\nTransverse Parabolic Shear Stress tau_xy(y) = (3P / 4c) * (1 - y^2/c^2):")
sp.pprint(sp.factor(tau_xy))

result = sigma_tensor`,
      assignTo: 'sigma_2d',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_elas_4',
      mode: 'code',
      title: '4. Principal Stresses (σ₁, σ₂), Von Mises Yield Criterion & Mohr Circle Plot',
      code: `# Symbolic 2D Plane Stress Principal Stresses & Von Mises Effective Stress
s_xx, s_yy, t_xy = sp.symbols('sigma_xx sigma_yy tau_xy', real=True)

sigma_avg = (s_xx + s_yy) / 2
R_mohr    = sp.sqrt(((s_xx - s_yy) / 2)**2 + t_xy**2)
sigma_1   = sigma_avg + R_mohr
sigma_2   = sigma_avg - R_mohr

# Plane Stress Von Mises Yield Criterion: sigma_vm = sqrt(sigma_xx^2 - sigma_xx*sigma_yy + sigma_yy^2 + 3*tau_xy^2)
sigma_vm = sp.sqrt(s_xx**2 - s_xx*s_yy + s_yy**2 + 3*t_xy**2)

print("Maximum Principal Stress sigma_1:")
sp.pprint(sigma_1)
print("\\nPlane-Stress Von Mises Equivalent Stress sigma_vm:")
sp.pprint(sigma_vm)

# Numerical Mohr Circle for sample state: sigma_xx = 120 MPa, sigma_yy = -40 MPa, tau_xy = 60 MPa
s_x_val, s_y_val, t_xy_val = 120.0, -40.0, 60.0
c_val = 0.5 * (s_x_val + s_y_val)
r_val = math.sqrt((0.5 * (s_x_val - s_y_val))**2 + t_xy_val**2)
angles = [2 * math.pi * i / 200 for i in range(201)]
plot_data = {
    'type': 'parametric',
    'x': [c_val + r_val * math.cos(th) for th in angles],
    'y': [r_val * math.sin(th) for th in angles],
    'var': 'theta',
    'xlab': 'Normal Stress σ_n (MPa)',
    'ylab': 'Shear Stress τ_n (MPa)',
    'title': f'Mohr Circle (Center = {c_val:.1f} MPa, R = {r_val:.1f} MPa, σ₁ = {c_val+r_val:.1f} MPa, σ₂ = {c_val-r_val:.1f} MPa)'
}

result = sigma_vm`,
      assignTo: 'sigma_vm',
      operation: 'eval',
      params: {}
    }
  ],

  // ==========================================================================
  // TEMPLATE 2: KIRCHHOFF-LOVE THIN PLATE BENDING (NAVIER'S METHOD FOR SSSS)
  // ==========================================================================
  kirchhoff_plate: [
    {
      id: 'cell_plate_1',
      mode: 'code',
      title: 'Cell 1: Geometry, Material Properties & Navier Double Sine Series Assumption (SSSS)',
      code: `# 1. Define plate dimensions (a, b), thickness h, Young's modulus E, Poisson's ratio nu (positive=True)
x, y = sp.symbols('x y', real=True)
a, b, h, E_p, nu = sp.symbols('a b h E nu', positive=True, real=True)
m, n = sp.symbols('m n', integer=True, positive=True)
W_mn = sp.Symbol('W_mn', real=True)

# 2. Flexural Rigidity D = E * h^3 / (12 * (1 - nu^2))
D = (E_p * h**3) / (12 * (1 - nu**2))

# 3. Navier's Double Sine Series Trial Term w_mn(x, y) for Simply Supported Rectangular Plate (SSSS)
phi_mn = sp.sin(m * sp.pi * x / a) * sp.sin(n * sp.pi * y / b)
w_mn   = W_mn * phi_mn

# Bending moment expressions for boundary verification:
M_xx_trial = -D * (sp.diff(w_mn, x, 2) + nu * sp.diff(w_mn, y, 2))
M_yy_trial = -D * (sp.diff(w_mn, y, 2) + nu * sp.diff(w_mn, x, 2))

print("Flexural Rigidity D:")
sp.pprint(D)
print("\\n--- Simply Supported (SSSS) Boundary Condition Verification (m, n integers) ---")
print(f"At x = 0:  w(0, y) = {w_mn.subs(x, 0)},   M_xx(0, y) = {sp.simplify(M_xx_trial.subs(x, 0))}")
print(f"At x = a:  w(a, y) = {sp.simplify(w_mn.subs(x, a))},   M_xx(a, y) = {sp.simplify(M_xx_trial.subs(x, a))}")
print(f"At y = 0:  w(x, 0) = {w_mn.subs(y, 0)},   M_yy(x, 0) = {sp.simplify(M_yy_trial.subs(y, 0))}")
print(f"At y = b:  w(x, b) = {sp.simplify(w_mn.subs(y, b))},   M_yy(x, b) = {sp.simplify(M_yy_trial.subs(y, b))}")

result = sp.Eq(sp.Symbol('D'), D)`,
      assignTo: 'D_plate',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_plate_2',
      mode: 'code',
      title: 'Cell 2: Governing Biharmonic Equation (∇⁴w) & Double Fourier Sine Load Expansion (q_mn)',
      code: `# 1. Compute 2D Biharmonic Operator nabla^4(phi_mn) = d4/dx4 + 2*d4/(dx2 dy2) + d4/dy4
biharmonic_phi = sp.simplify(
    sp.diff(phi_mn, x, 4) + 2 * sp.diff(phi_mn, x, 2, y, 2) + sp.diff(phi_mn, y, 4)
)
biharmonic_factored = sp.factor(biharmonic_phi)

# 2. Double Fourier Sine Load Coefficient:
# q_mn = (4 / (a*b)) * int_0^a int_0^b q(x, y) * sin(m*pi*x/a) * sin(n*pi*y/b) dx dy
q_0 = sp.Symbol('q_0', positive=True, real=True)

# Case A: Uniform Distributed Load q(x, y) = q_0
q_mn_uniform_raw = (4 / (a * b)) * sp.integrate(
    sp.integrate(q_0 * phi_mn, (x, 0, a)),
    (y, 0, b)
)
q_mn_uniform_general = sp.simplify(q_mn_uniform_raw)
# For odd harmonics m, n (where cos(m*pi) = -1 and cos(n*pi) = -1):
q_mn_uniform_odd = (16 * q_0) / (sp.pi**2 * m * n)

# Case B: Sinusoidal Load q(x, y) = q_0 * sin(pi*x/a) * sin(pi*y/b) -> Single harmonic (m=1, n=1)
q_11_sinusoidal = (4 / (a * b)) * sp.integrate(
    sp.integrate(q_0 * sp.sin(sp.pi * x / a)**2 * sp.sin(sp.pi * y / b)**2, (x, 0, a)),
    (y, 0, b)
)

print("Biharmonic Eigenfunction Identity nabla^4[sin(m*pi*x/a)*sin(n*pi*y/b)]:")
sp.pprint(biharmonic_factored)
print("\\nCase 1 — Uniform Load q(x,y) = q_0 (general m, n):")
sp.pprint(q_mn_uniform_general)
print("Case 1 — Uniform Load q_mn for odd (m, n):")
sp.pprint(q_mn_uniform_odd)
print(f"\\nCase 2 — Sinusoidal Load q_11 = {sp.simplify(q_11_sinusoidal)}")

result = biharmonic_factored`,
      assignTo: 'biharmonic_term',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_plate_3',
      mode: 'code',
      title: 'Cell 3: Solve for Deflection Amplitude W_mn & Internal Stress Resultants (M_xx, M_yy, M_xy, Q_x, Q_y)',
      code: `# Equate D * nabla^4(w_mn) = q_mn * sin(m*pi*x/a)*sin(n*pi*y/b) and solve for W_mn
q_mn = sp.Symbol('q_mn', real=True)
D_sym = sp.Symbol('D', positive=True, real=True)

gov_eq = sp.Eq(D_sym * W_mn * sp.pi**4 * ((m / a)**2 + (n / b)**2)**2, q_mn)
W_mn_sol = sp.solve(gov_eq, W_mn)[0]

# Substitute w_mn = W_mn * sin(m*pi*x/a) * sin(n*pi*y/b) into Plate Stress Resultants:
w_term = W_mn_sol * phi_mn
M_xx = sp.simplify(-D_sym * (sp.diff(w_term, x, 2) + nu * sp.diff(w_term, y, 2)))
M_yy = sp.simplify(-D_sym * (sp.diff(w_term, y, 2) + nu * sp.diff(w_term, x, 2)))
M_xy = sp.simplify(-D_sym * (1 - nu) * sp.diff(w_term, x, y))

# Transverse Shear Forces Q_x = -D * d/dx(nabla^2 w), Q_y = -D * d/dy(nabla^2 w)
lap_w = sp.diff(w_term, x, 2) + sp.diff(w_term, y, 2)
Q_x   = sp.simplify(-D_sym * sp.diff(lap_w, x))
Q_y   = sp.simplify(-D_sym * sp.diff(lap_w, y))

print("Solved Navier Deflection Harmonic Amplitude W_mn:")
sp.pprint(W_mn_sol)
print("\\nBending Moment Harmonic M_xx(x, y):")
sp.pprint(M_xx)
print("\\nBending Moment Harmonic M_yy(x, y):")
sp.pprint(M_yy)
print("\\nTwisting Moment Harmonic M_xy(x, y):")
sp.pprint(M_xy)

result = sp.Eq(sp.Symbol('W_mn'), W_mn_sol)`,
      assignTo: 'W_mn_expr',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_plate_4',
      mode: 'code',
      title: 'Cell 4: Truncated Series Numerical Evaluation, Timoshenko Benchmark & 3D Stress-Contoured Plate Plot',
      code: `# User-Tweakable Plate & Navier Series Parameters (Aluminum Plate under Uniform Load)
M_max, N_max = 5, 5          # Odd harmonic truncation limits (m, n = 1, 3, 5)
a_val  = 1.0                 # Plate length a (m)
b_val  = 1.0                 # Plate width b (m)
h_val  = 0.01                # Plate thickness h (m)
E_val  = 70.0e9              # Young's modulus E (Pa) - 70 GPa
nu_val = 0.30                # Poisson's ratio nu
q0_val = 10.0e3              # Uniform transverse pressure q_0 (N/m^2) - 10 kPa

# Flexural rigidity D (N*m)
D_val = (E_val * h_val**3) / (12.0 * (1.0 - nu_val**2))

# Build truncated symbolic series for w(x, y) and M_xx(x, y) over odd harmonics (m, n = 1, 3, ..., M_max)
w_series_num   = 0
Mxx_series_num = 0
for m_i in range(1, M_max + 1, 2):
    for n_i in range(1, N_max + 1, 2):
        q_mn_i = 16.0 * q0_val / (math.pi**2 * m_i * n_i)
        denom_i = (math.pi**4) * D_val * ((m_i / a_val)**2 + (n_i / b_val)**2)**2
        W_mn_i = q_mn_i / denom_i
        kx = m_i * math.pi / a_val
        ky = n_i * math.pi / b_val
        harm_i = sp.sin(kx * x) * sp.sin(ky * y)
        w_series_num   += W_mn_i * harm_i
        Mxx_series_num += D_val * W_mn_i * (kx**2 + nu_val * ky**2) * harm_i

# Extreme-fiber bending stress at z = h/2: sigma_xx = 6 * M_xx / h^2
sigma_xx_series = (6.0 / (h_val**2)) * Mxx_series_num

# Evaluate center deflection w_max = w(a/2, b/2) and compare with Timoshenko benchmark (alpha = 0.004062)
w_center_navier = float(w_series_num.subs({x: a_val / 2.0, y: b_val / 2.0}))
alpha_navier    = w_center_navier * D_val / (q0_val * a_val**4)
alpha_timo      = 0.004062
w_center_timo   = alpha_timo * (q0_val * a_val**4) / D_val
rel_err_pct     = abs(w_center_navier - w_center_timo) / w_center_timo * 100.0
sigma_xx_center = float(sigma_xx_series.subs({x: a_val / 2.0, y: b_val / 2.0})) / 1e6  # in MPa

print(f"Flexural Rigidity D                 = {D_val:.3f} N·m")
print(f"Navier Center Deflection w(a/2,b/2) = {w_center_navier*1e3:.5f} mm (alpha = {alpha_navier:.6f})")
print(f"Timoshenko Benchmark Deflection     = {w_center_timo*1e3:.5f} mm (alpha = {alpha_timo:.6f})")
print(f"Series Convergence Discrepancy      = {rel_err_pct:.4f}% (at M_max={M_max}, N_max={N_max})")
print(f"Max Center Bending Stress sigma_xx  = {sigma_xx_center:.3f} MPa (at z = +h/2)")

# Generate 3D Mesh for Deformed Plate Surface w(x, y) colored by Bending Stress sigma_xx (MPa)
grid_n = 41
xs = [i * a_val / (grid_n - 1) for i in range(grid_n)]
ys = [j * b_val / (grid_n - 1) for j in range(grid_n)]
fn_w   = sp.lambdify((x, y), w_series_num * 1e3, modules=['math'])       # Deflection in mm
fn_sxx = sp.lambdify((x, y), sigma_xx_series / 1e6, modules=['math'])    # Stress sigma_xx in MPa

zs_mm = [[float(fn_w(xv, yv)) for xv in xs] for yv in ys]
sxx_mpa = [[float(fn_sxx(xv, yv)) for xv in xs] for yv in ys]

plot_data = {
    'type': '3d',
    'x': xs,
    'y': ys,
    'z': zs_mm,
    'surfacecolor': sxx_mpa,
    'colorbarTitle': 'σ_xx (MPa)',
    'zlab': 'w(x,y) [mm]',
    'title': f'Navier SSSS Plate Deflection w(x,y) [mm] & Extreme-Fiber Stress σ_xx [MPa] (w_max = {w_center_navier*1e3:.3f} mm)'
}

result = sp.Float(w_center_navier, 6)`,
      assignTo: 'w_max_navier',
      operation: 'eval',
      params: {}
    }
  ],

  // ==========================================================================
  // TEMPLATE 3: MAGNETOSTATICS & ELECTRODYNAMICS
  // ==========================================================================
  magnetostatics: [
    {
      id: 'cell_mag_1',
      mode: 'code',
      title: '1. Biot-Savart Law: Finite Straight Current Wire & Circular Loop on Axis',
      code: `# Biot-Savart Law integration for:
# (A) Finite straight wire along z-axis from -L1 to L2 observed at radial distance r
# (B) Circular current loop of radius R carrying current I observed on the symmetry axis z
mu_0, I_curr, r_cyl, R_loop, z_ax, zp = sp.symbols('mu_0 I r R z z_p', positive=True, real=True)
L1, L2 = sp.symbols('L_1 L_2', positive=True, real=True)

# (A) dB_phi = (mu_0 * I / (4*pi)) * (r / (r^2 + zp^2)**(3/2)) dzp
dB_wire = (mu_0 * I_curr / (4 * sp.pi)) * (r_cyl / (r_cyl**2 + zp**2)**sp.Rational(3, 2))
B_phi_wire = sp.simplify(sp.integrate(dB_wire, (zp, -L1, L2)))

# (B) Circular Loop on-axis field B_z(z) integrated over azimuthal angle phi in [0, 2*pi]
B_z_loop = sp.simplify(
    sp.integrate((mu_0 * I_curr / (4 * sp.pi)) * (R_loop**2 / (R_loop**2 + z_ax**2)**sp.Rational(3, 2)), (phi, 0, 2 * sp.pi))
)

print("Magnetic Flux Density B_phi(r) for Finite Wire [-L1, L2]:")
sp.pprint(B_phi_wire)
print("\\nOn-Axis Magnetic Flux Density B_z(z) for Circular Current Loop:")
sp.pprint(B_z_loop)

result = B_z_loop`,
      assignTo: 'B_z_loop',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_mag_2',
      mode: 'code',
      title: '2. Magnetic Vector Potential A(x, y, z) & Flux Density B = ∇ × A',
      code: `# Define Magnetic Vector Potential A = [A_x, A_y, A_z] for a uniform axial current density J_0 along z:
# Inside a cylindrical conductor: A_z(x, y) = -(mu_0 * J_0 / 4) * (x^2 + y^2)
x, y, z = sp.symbols('x y z', real=True)
mu_0, J_0 = sp.symbols('mu_0 J_0', positive=True, real=True)

A_vec = sp.Matrix([
    0,
    0,
    -(mu_0 * J_0 / 4) * (x**2 + y**2)
])

# Compute Magnetic Flux Density B = curl(A) = nabla x A
coords = [x, y, z]
B_vec = sp.Matrix([
    sp.diff(A_vec[2], y) - sp.diff(A_vec[1], z),
    sp.diff(A_vec[0], z) - sp.diff(A_vec[2], x),
    sp.diff(A_vec[1], x) - sp.diff(A_vec[0], y)
])

print("Magnetic Vector Potential A(x, y, z):")
sp.pprint(A_vec)
print("\\nMagnetic Flux Density B = curl(A):")
sp.pprint(B_vec)

result = B_vec`,
      assignTo: 'B_vec',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_mag_3',
      mode: 'code',
      title: '3. Symbolic Maxwell-Ampère Verification (∇ × B = μ₀ J) & Gauss Magnetism Law (∇ · B = 0)',
      code: `# 1. Verify Gauss's Law for Magnetism: div(B) = nabla . B == 0
div_B = sp.simplify(sp.diff(B_vec[0], x) + sp.diff(B_vec[1], y) + sp.diff(B_vec[2], z))

# 2. Verify Maxwell-Ampere Law: curl(B) = nabla x B = mu_0 * J
curl_B = sp.Matrix([
    sp.diff(B_vec[2], y) - sp.diff(B_vec[1], z),
    sp.diff(B_vec[0], z) - sp.diff(B_vec[2], x),
    sp.diff(B_vec[1], x) - sp.diff(B_vec[0], y)
])
J_recovered = sp.simplify(curl_B / mu_0)

print(f"Gauss Law Check (nabla · B == 0): {div_B}")
print("\\nCurl of B (nabla × B = mu_0 * J):")
sp.pprint(curl_B)
print("\\nRecovered Current Density Vector J = (nabla × B) / mu_0:")
sp.pprint(J_recovered)

result = curl_B`,
      assignTo: 'curl_B',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_mag_4',
      mode: 'visual',
      title: '4. 2D Vector Field Quiver Plot of Azimuthal Magnetic Field B(x, y)',
      latex: '\\left[-\\frac{I \\cdot y}{x^2 + y^2 + 0.25}, \\frac{I \\cdot x}{x^2 + y^2 + 0.25}\\right]',
      operation: 'plot_vector_2d',
      params: { xmin: '-3', xmax: '3', ymin: '-3', ymax: '3', grid: '16' },
      assignTo: ''
    }
  ],

  // ==========================================================================
  // TEMPLATE 4: VIBRATION & 2-DOF STRUCTURAL DYNAMICS
  // ==========================================================================
  vibration_2dof: [
    {
      id: 'cell_vib_1',
      mode: 'code',
      title: '1. Mass Matrix [M] & Stiffness Matrix [K] Setup for 2-DOF Spring-Mass System',
      code: `# 2-DOF Undamped Structural System: [M] * x''(t) + [K] * x(t) = 0
m, k = sp.symbols('m k', positive=True, real=True)
omega = sp.Symbol('omega', positive=True, real=True)

# Mass Matrix [M] and Coupled Stiffness Matrix [K] (with coupling spring k between m1=m and m2=m)
M_mat = sp.Matrix([
    [m, 0],
    [0, m]
])
K_mat = sp.Matrix([
    [2*k, -k],
    [-k,  2*k]
])

print("Mass Matrix [M]:")
sp.pprint(M_mat)
print("\\nStiffness Matrix [K]:")
sp.pprint(K_mat)

result = K_mat`,
      assignTo: 'K_2dof',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_vib_2',
      mode: 'code',
      title: '2. Characteristic Equation det([K] - ω²[M]) = 0',
      code: `# Dynamic Impedance / Secular Matrix: [D(omega)] = [K] - omega^2 * [M]
dyn_mat  = K_mat - omega**2 * M_mat
char_eq  = sp.factor(dyn_mat.det())

print("Dynamic Matrix [K] - omega^2 [M]:")
sp.pprint(dyn_mat)
print("\\nFactored Characteristic Determinant det([K] - omega^2 [M]) = 0:")
sp.pprint(sp.Eq(char_eq, 0))

result = sp.Eq(char_eq, 0)`,
      assignTo: 'char_eq_2dof',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_vib_3',
      mode: 'code',
      title: '3. Natural Frequencies (ω₁, ω₂) & Mass-Normalized Mode Shape Eigenvectors',
      code: `# Solve Characteristic Equation for Natural Frequencies omega_1, omega_2
nat_freqs = sorted(sp.solve(char_eq, omega), key=lambda w: float(w.subs({k: 1, m: 1})))
omega_1, omega_2 = nat_freqs[0], nat_freqs[1]

# Compute Mode Shape Eigenvectors from ([K] - omega_i^2 [M]) * phi_i = 0
phi_1 = (K_mat - omega_1**2 * M_mat).nullspace()[0]
phi_2 = (K_mat - omega_2**2 * M_mat).nullspace()[0]

# Mass-Orthogonality Verification: phi_1^T * [M] * phi_2 == 0
ortho_check = (phi_1.T * M_mat * phi_2)[0, 0]

print(f"Fundamental Frequency omega_1 (In-Phase Symmetric Mode)  = {omega_1}")
print(f"Second Frequency      omega_2 (Out-of-Phase Mode)        = {omega_2}")
print(f"Mass-Orthogonality Check (phi_1^T * [M] * phi_2 == 0)    = {ortho_check}")

Modal_Matrix = sp.Matrix.hstack(phi_1, phi_2)
result = Modal_Matrix`,
      assignTo: 'Modal_Phi',
      operation: 'eval',
      params: {}
    },
    {
      id: 'cell_vib_4',
      mode: 'visual',
      title: '4. Multi-Curve Modal Beat Response x₁(t), x₂(t) with Interactive Frequency Sliders',
      latex: '\\cos(\\omega_1 t) + 0.5 \\cos(\\omega_2 t)',
      operation: 'plot_2d',
      params: {
        var: 't',
        xmin: '0',
        xmax: '25',
        overlay: 'cos(omega_1*t) - 0.5*cos(omega_2*t)',
        labels: 'DOF 1: x₁(t), DOF 2: x₂(t)',
        points: '500'
      },
      assignTo: ''
    }
  ],

  // ==========================================================================
  // FOUNDATIONAL CAS STARTERS
  // ==========================================================================
  default: [
    {
      id: 'cell_init_1',
      mode: 'visual',
      latex: 'f(x) = x^2 \\sin(x)',
      operation: 'eval',
      params: {},
      assignTo: '',
      inIndex: null
    },
    {
      id: 'cell_init_2',
      mode: 'visual',
      latex: 'f(x)',
      operation: 'diff',
      params: { var: 'x', order: '1' },
      assignTo: 'df',
      inIndex: null
    },
    {
      id: 'cell_init_3',
      mode: 'visual',
      latex: '\\frac{\\sin(x)}{x}',
      operation: 'series',
      params: { var: 'x', point: '0', order: '8' },
      assignTo: '',
      inIndex: null
    },
    {
      id: 'cell_init_4',
      mode: 'visual',
      latex: '\\sin(x) \\cdot \\cos(y) \\cdot \\exp\\left(-\\frac{x^2+y^2}{10}\\right)',
      operation: 'plot_3d',
      params: { xmin: '-4', xmax: '4', ymin: '-4', ymax: '4' },
      assignTo: '',
      inIndex: null
    }
  ],
  harmonic: [
    {
      id: 'cell_harm_1',
      mode: 'visual',
      latex: 'y\'\'(x) + 2\\cdot y\'(x) + 10\\cdot y(x) = 0',
      operation: 'ode_solve',
      params: { func: 'y(x)', ic1: 'y(0)=1', ic2: "y'(0)=0" },
      assignTo: 'sol_ode',
      inIndex: null
    },
    {
      id: 'cell_harm_2',
      mode: 'visual',
      latex: '%1',
      operation: 'plot_2d',
      params: { var: 'x', xmin: '0', xmax: '6', points: '500' },
      assignTo: '',
      inIndex: null
    }
  ],
  electrostatics: [
    {
      id: 'cell_elec_1',
      mode: 'visual',
      latex: 'V(x,y,z) = \\frac{q}{\\sqrt{x^2 + y^2 + z^2}}',
      operation: 'eval',
      params: {},
      assignTo: '',
      inIndex: null
    },
    {
      id: 'cell_elec_2',
      mode: 'visual',
      latex: '-\\frac{q}{\\sqrt{x^2 + y^2 + z^2}}',
      operation: 'curv_grad',
      params: { system: 'cartesian', coords: 'x, y, z' },
      assignTo: 'E_field',
      inIndex: null
    },
    {
      id: 'cell_elec_3',
      mode: 'visual',
      latex: '\\frac{1}{\\sqrt{1 - 2\\cdot x\\cdot t + t^2}}',
      operation: 'series',
      params: { var: 't', point: '0', order: '4' },
      assignTo: 'legendre_gen',
      inIndex: null
    }
  ],
  linalg: [
    {
      id: 'cell_la_1',
      mode: 'visual',
      latex: '\\begin{pmatrix} 2 & -1 & 0 \\\\ -1 & 2 & -1 \\\\ 0 & -1 & 2 \\end{pmatrix}',
      operation: 'eval',
      params: {},
      assignTo: 'K_mat',
      inIndex: null
    },
    {
      id: 'cell_la_2',
      mode: 'visual',
      latex: 'K_{mat}',
      operation: 'mat_eigen',
      params: {},
      assignTo: '',
      inIndex: null
    },
    {
      id: 'cell_la_3',
      mode: 'visual',
      latex: 'K_{mat}',
      operation: 'mat_inv',
      params: {},
      assignTo: 'K_inv',
      inIndex: null
    }
  ]
};

// The Python kernel (LaTeX parser, session memory, operations) lives in kernel/*.py and is
// bundled into kernel_bundle.js by tools/build_kernel.py; it runs inside a Web Worker.

// ============================================================================
// INITIALIZATION & PYODIDE KERNEL SETUP
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initUIHandlers();
  loadNotebookFromStorageOrDefault();
  bootPyodideKernel();
});

// Official jsDelivr endpoints only. pyodide.js is checked against PYODIDE_JS_SHA384 before it runs;
// SymPy and its dependencies are checked by Pyodide against the SHA-256 hashes in pyodide-lock.json.
const PYODIDE_VERSION = '0.26.1';
const PYODIDE_JS_SHA384 = 'Zt+txBUVind9SDPtCx7HTNK8jiZiFKX/Cm3Ml1tEnAmGKO/QSRn1VqM+Vr45Cbrj';
const PYODIDE_MIRRORS = [
  { url: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`, name: 'jsDelivr' },
  { url: `https://fastly.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`, name: 'jsDelivr (Fastly)' },
  { url: `https://gcore.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`, name: 'jsDelivr (Gcore)' }
];

const TIME_LIMIT_KEY = 'sympystudio_time_limit_s';
const PARSER_OPTIONS_KEY = 'sympystudio_parser_options';

/**
 * Main-thread client for the kernel worker (kernel/worker.js).
 * Every Python call is asynchronous; Kernel.interrupt() stops the running computation.
 */
const Kernel = {
  worker: null,
  pending: new Map(),
  nextId: 1,
  interruptBuffer: null,
  bootPromise: null,

  // True when the page is cross-origin isolated (served by tools/serve.py): Stop then
  // interrupts Python and keeps the session. Otherwise Stop has to restart the worker.
  get canInterrupt() {
    return !!this.interruptBuffer;
  },

  start() {
    if (this.bootPromise) return this.bootPromise;
    const bundle = window.SYMPYSTUDIO_KERNEL;
    if (!bundle) {
      return Promise.reject(new Error('kernel_bundle.js is missing. Run: python tools/build_kernel.py'));
    }
    const url = URL.createObjectURL(new Blob([bundle.worker], { type: 'text/javascript' }));
    this.worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.interruptBuffer = (window.crossOriginIsolated && typeof SharedArrayBuffer === 'function')
      ? new Uint8Array(new SharedArrayBuffer(1)) : null;

    this.bootPromise = new Promise((resolve, reject) => {
      this.worker.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.type === 'status') {
          setKernelStatus('loading', msg.text);
        } else if (msg.type === 'ready') {
          resolve();
        } else if (msg.type === 'init-error') {
          reject(new Error(msg.message));
        } else if (msg.type === 'result') {
          const entry = this.pending.get(msg.id);
          if (!entry) return;
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.ok) {
            entry.resolve(msg.value);
          } else {
            const err = new Error(msg.interrupted ? (entry.stopReason || 'Stopped before it finished; your variables are unchanged.') : msg.error);
            err.interrupted = !!msg.interrupted;
            entry.reject(err);
          }
        }
      };
      this.worker.onerror = (ev) => reject(new Error(ev.message || 'Kernel worker failed to start'));
    });
    this.worker.postMessage({
      type: 'init',
      mirrors: PYODIDE_MIRRORS,
      pyodideSha384: PYODIDE_JS_SHA384,
      python: bundle.python,
      interruptBuffer: this.interruptBuffer
    });
    return this.bootPromise;
  },

  /** Call a Python function in the kernel. opts.timeLimit (seconds) stops it when exceeded. */
  call(fn, args = [], opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Kernel is not running.'));
        return;
      }
      const id = this.nextId++;
      const entry = { resolve, reject, timer: null, fn };
      const limit = opts.timeLimit;
      if (limit && limit > 0) {
        entry.timer = setTimeout(() => {
          entry.timedOut = true;
          this.interrupt(`Stopped after ${limit} s (time limit, change it in the Memory panel).`);
        }, limit * 1000);
      }
      this.pending.set(id, entry);
      if (this.interruptBuffer) this.interruptBuffer[0] = 0;
      this.worker.postMessage({ type: 'call', id, fn, args });
    });
  },

  get busy() {
    return this.pending.size > 0;
  },

  /** Stop the running computation. `reason` (optional) explains why, e.g. a time limit. */
  interrupt(reason = null) {
    if (!this.worker || !this.busy) return;
    if (this.interruptBuffer) {
      this.interruptBuffer[0] = 2; // SIGINT -> KeyboardInterrupt inside Python
      const msg = reason || 'Stopped before it finished; your variables are unchanged.';
      for (const entry of this.pending.values()) entry.stopReason = msg;
      // If Python does not reach a checkpoint quickly (long C-level loop), fall back to a restart.
      const stuck = new Set(this.pending.keys());
      setTimeout(() => {
        if ([...stuck].some(id => this.pending.has(id))) this.restart('Python did not respond to the stop request.');
      }, 4000);
      return;
    }
    this.restart(reason || 'Stopped.');
  },

  /** Terminate the worker and boot a fresh one (session memory is lost). */
  restart(reason = 'Stopped.') {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.bootPromise = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      const err = new Error(`${reason} The kernel was restarted, so variables were cleared: use Run All to rebuild them.`);
      err.interrupted = true;
      entry.reject(err);
    }
    this.pending.clear();
    AppState.kernelReady = false;
    bootPyodideKernel();
  }
};

function getTimeLimitSeconds() {
  try {
    const raw = localStorage.getItem(TIME_LIMIT_KEY);
    if (raw !== null) return Math.max(0, parseInt(raw, 10) || 0);
  } catch (_) {}
  return 120;
}

function getParserOptions() {
  try {
    const raw = JSON.parse(localStorage.getItem(PARSER_OPTIONS_KEY) || 'null');
    if (raw && typeof raw === 'object') return { euler_e: raw.euler_e !== false, imaginary_i: raw.imaginary_i !== false };
  } catch (_) {}
  return { euler_e: true, imaginary_i: true };
}

/** Wire the "Input & Kernel Settings" panel (e/i interpretation, time limit). */
function initKernelSettingsUI() {
  const opts = getParserOptions();
  const eulerBox = document.getElementById('optEulerE');
  const imagBox = document.getElementById('optImaginaryI');
  const limitSel = document.getElementById('optTimeLimit');
  const note = document.getElementById('interruptModeNote');
  if (eulerBox) eulerBox.checked = opts.euler_e;
  if (imagBox) imagBox.checked = opts.imaginary_i;
  if (limitSel) limitSel.value = String(getTimeLimitSeconds());
  if (note) {
    note.textContent = window.crossOriginIsolated
      ? 'Stop interrupts the computation and keeps your variables.'
      : 'Stop restarts the kernel (variables are cleared). Serve the app with tools/serve.py to keep variables when stopping.';
  }

  const saveParserOptions = async () => {
    const next = { euler_e: !!eulerBox?.checked, imaginary_i: !!imagBox?.checked };
    try { localStorage.setItem(PARSER_OPTIONS_KEY, JSON.stringify(next)); } catch (_) {}
    if (AppState.kernelReady) await Kernel.call('set_parser_options', [JSON.stringify(next)]);
  };
  eulerBox?.addEventListener('change', saveParserOptions);
  imagBox?.addEventListener('change', saveParserOptions);
  limitSel?.addEventListener('change', () => {
    try { localStorage.setItem(TIME_LIMIT_KEY, limitSel.value); } catch (_) {}
  });
}

async function bootPyodideKernel() {
  setKernelStatus('loading', 'Starting kernel...');
  try {
    await Kernel.start();
    await Kernel.call('set_parser_options', [JSON.stringify(getParserOptions())]);
    AppState.kernelReady = true;
    setKernelStatus('ready', 'Kernel: Ready (SymPy Active)');

    // Bind the kernel memory to the active notebook tab, restore its assumptions and evaluate it
    const activeTab = getActiveTab();
    if (activeTab) {
      await activateKernelSessionForTab(activeTab);
    }
  } catch (err) {
    console.error('Kernel start failed:', err);
    if (Kernel.worker) Kernel.worker.terminate();
    Kernel.worker = null;
    Kernel.bootPromise = null;
    setKernelStatus('error', 'Kernel Error: Click to Retry');
    const pill = document.getElementById('kernelStatusPill');
    if (pill) {
      pill.style.cursor = 'pointer';
      pill.title = `Error: ${err?.message || err}. Click to retry.`;
      pill.onclick = () => {
        pill.onclick = null;
        bootPyodideKernel();
      };
    }
  }
}

function setKernelStatus(state, text) {
  const pill = document.getElementById('kernelStatusPill');
  const spinner = document.getElementById('kernelSpinner');
  const dot = document.getElementById('kernelDot');
  const label = document.getElementById('kernelStatusText');

  label.textContent = text;
  pill.className = 'flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium border transition-all shrink-0 ';

  if (state === 'loading' || state === 'busy') {
    pill.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-200');
    spinner.classList.remove('hidden');
    dot.classList.add('hidden');
  } else if (state === 'ready') {
    pill.classList.add('bg-emerald-50', 'text-emerald-800', 'border-emerald-200');
    spinner.classList.add('hidden');
    dot.classList.remove('hidden');
    dot.className = 'w-2 h-2 rounded-full bg-emerald-600';
    pill.style.cursor = 'default';
    pill.onclick = null;
  } else {
    pill.classList.add('bg-red-50', 'text-red-800', 'border-red-200');
    spinner.classList.add('hidden');
    dot.classList.remove('hidden');
    dot.className = 'w-2 h-2 rounded-full bg-red-600';
  }
}

// ============================================================================
// UI EVENT HANDLERS & RIBBON NAVIGATION
// ============================================================================

function initUIHandlers() {
  // Ribbon Tab Switching
  const tabs = document.querySelectorAll('.ribbon-tab');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      switchRibbonTab(targetId);
    });
  });

  // Operation Preset Buttons in Ribbon
  document.querySelectorAll('.op-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const opKey = btn.getAttribute('data-op');
      applyOperationToActiveCell(opKey);
    });
  });

  // ODE Template Quick-Insert Buttons
  document.querySelectorAll('.ode-template-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = btn.getAttribute('data-ode-template');
      insertOdeTemplate(tpl);
    });
  });

  // Matrix Quick Insert Buttons (2x2, 3x3, 4x4)
  document.querySelectorAll('.matrix-insert-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const dim = parseInt(btn.getAttribute('data-matrix'), 10);
      insertMatrixLatexIntoActiveCell(dim, dim);
    });
  });

  // Visual Matrix Builder Modal
  document.getElementById('btnOpenMatrixModal').addEventListener('click', openMatrixModal);
  document.getElementById('btnCloseMatrixModal').addEventListener('click', closeMatrixModal);
  document.getElementById('btnCancelMatrix').addEventListener('click', closeMatrixModal);
  document.getElementById('matrixRowsSelect').addEventListener('change', renderMatrixModalGrid);
  document.getElementById('matrixColsSelect').addEventListener('change', renderMatrixModalGrid);
  document.getElementById('btnFillIdentity').addEventListener('click', fillModalIdentityMatrix);
  document.getElementById('btnInsertMatrixGrid').addEventListener('click', insertModalMatrixIntoCell);

  // Symbol Palette Insertion Buttons
  document.querySelectorAll('.palette-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Keep focus in MathLive editor
      const latexSnippet = btn.getAttribute('data-latex');
      insertLatexIntoActiveMathField(latexSnippet);
    });
  });

  // Toggle Operations Ribbon Panel Container
  const btnToggleRibbon = document.getElementById('btnToggleRibbon');
  if (btnToggleRibbon) {
    btnToggleRibbon.addEventListener('click', () => {
      AppState.ribbonOpen = !AppState.ribbonOpen;
      const container = document.getElementById('ribbonPanelsContainer');
      const chevron = document.getElementById('ribbonChevron');
      if (container) {
        container.classList.toggle('ribbon-collapsed', !AppState.ribbonOpen);
      }
      if (chevron) {
        chevron.style.transform = AppState.ribbonOpen ? 'rotate(0deg)' : 'rotate(180deg)';
      }
    });
  }

  // Toggle Math Palette Drawer
  document.getElementById('btnTogglePalette').addEventListener('click', () => {
    AppState.paletteOpen = !AppState.paletteOpen;
    const drawer = document.getElementById('mathPaletteDrawer');
    const chevron = document.getElementById('paletteChevron');
    if (AppState.paletteOpen) {
      drawer.classList.remove('hidden');
      chevron.style.transform = 'rotate(0deg)';
    } else {
      drawer.classList.add('hidden');
      chevron.style.transform = 'rotate(-180deg)';
    }
  });

  // Shared Actions for Desktop & Mobile Controls
  async function clearSessionMemory() {
    if (!AppState.kernelReady) return;
    await Kernel.call('reset_session_memory');
    AppState.evalCounter = 0;
    AppState.symbolAssumptions = {};
    updateVariableInspectorUI({ vars: [], outs: [], assumptions: [] });
    saveNotebookToLocalStorage();
  }

  function exportPrintNotebook() {
    const tsEl = document.getElementById('printTimestamp');
    if (tsEl) tsEl.textContent = 'Exported on ' + new Date().toLocaleString();
    window.print();
  }

  function resizeAllPlots() {
    document.querySelectorAll('.plotly-output-container:not(.hidden) > div[id^="plot_"]').forEach(plotEl => {
      if (typeof Plotly !== 'undefined' && plotEl && plotEl.data) {
        Plotly.Plots.resize(plotEl);
      }
    });
  }

  // Mobile / Tablet Overflow Menu ("..." Button)
  const btnMobileMore = document.getElementById('btnMobileMore');
  const mobileMoreMenu = document.getElementById('mobileMoreMenu');
  if (btnMobileMore && mobileMoreMenu) {
    btnMobileMore.addEventListener('click', (e) => {
      e.stopPropagation();
      mobileMoreMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
      if (!mobileMoreMenu.contains(e.target) && e.target !== btnMobileMore) {
        mobileMoreMenu.classList.add('hidden');
      }
    });
  }

  const btnMobileSaveJson = document.getElementById('btnMobileSaveJson');
  if (btnMobileSaveJson) {
    btnMobileSaveJson.addEventListener('click', () => {
      if (mobileMoreMenu) mobileMoreMenu.classList.add('hidden');
      downloadNotebookJson();
    });
  }

  const inputMobileLoadJson = document.getElementById('inputMobileLoadJson');
  if (inputMobileLoadJson) {
    inputMobileLoadJson.addEventListener('change', (ev) => {
      if (mobileMoreMenu) mobileMoreMenu.classList.add('hidden');
      uploadNotebookJson(ev);
    });
  }

  const btnMobilePrint = document.getElementById('btnMobilePrint');
  if (btnMobilePrint) {
    btnMobilePrint.addEventListener('click', () => {
      if (mobileMoreMenu) mobileMoreMenu.classList.add('hidden');
      exportPrintNotebook();
    });
  }

  const btnMobileClearMemory = document.getElementById('btnMobileClearMemory');
  if (btnMobileClearMemory) {
    btnMobileClearMemory.addEventListener('click', async () => {
      if (mobileMoreMenu) mobileMoreMenu.classList.add('hidden');
      await clearSessionMemory();
    });
  }

  // Toggle Variable Inspector Sidebar (Responsive Drawer on Mobile/Tablet, Docked on Desktop)
  function updateSidebarVisibility() {
    const isDesktop = window.innerWidth >= 1024;
    const sidebar = document.getElementById('inspectorSidebar');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!sidebar) return;

    if (isDesktop) {
      if (backdrop) backdrop.classList.add('hidden');
      sidebar.classList.remove('sidebar-open-mobile');
      sidebar.classList.toggle('sidebar-closed-desktop', !AppState.sidebarOpen);
    } else {
      sidebar.classList.remove('sidebar-closed-desktop');
      sidebar.classList.toggle('sidebar-open-mobile', AppState.sidebarOpen);
      if (backdrop) {
        backdrop.classList.toggle('hidden', !AppState.sidebarOpen);
      }
    }
  }

  document.getElementById('btnToggleSidebar').addEventListener('click', () => {
    AppState.sidebarOpen = !AppState.sidebarOpen;
    updateSidebarVisibility();
    setTimeout(resizeAllPlots, 220);
  });

  const btnCloseSidebarMobile = document.getElementById('btnCloseSidebarMobile');
  if (btnCloseSidebarMobile) {
    btnCloseSidebarMobile.addEventListener('click', () => {
      AppState.sidebarOpen = false;
      updateSidebarVisibility();
    });
  }

  const sidebarBackdrop = document.getElementById('sidebarBackdrop');
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      AppState.sidebarOpen = false;
      updateSidebarVisibility();
    });
  }

  // Touch swipe to close the inspector drawer on mobile/tablet
  const sidebarEl = document.getElementById('inspectorSidebar');
  if (sidebarEl) {
    let touchStartX = 0;
    sidebarEl.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        touchStartX = e.touches[0].clientX;
      }
    }, { passive: true });
    sidebarEl.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        const touchEndX = e.changedTouches[0].clientX;
        if (touchEndX - touchStartX > 60) {
          AppState.sidebarOpen = false;
          updateSidebarVisibility();
        }
      }
    }, { passive: true });
  }

  // Auto-resize Plotly charts on window resize & orientation change
  window.addEventListener('resize', () => {
    updateSidebarVisibility();
    resizeAllPlots();
  });

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      updateSidebarVisibility();
      resizeAllPlots();
    }, 200);
  });

  // Apply initial sidebar visibility
  updateSidebarVisibility();

  initKernelSettingsUI();

  // Symbolic Assumptions Manager Apply Button
  const btnApplyAssumptions = document.getElementById('btnApplyAssumptions');
  if (btnApplyAssumptions) {
    btnApplyAssumptions.addEventListener('click', () => {
      applyAssumptionsFromUI();
    });
  }
  const assumptionsInput = document.getElementById('assumptionsSymbolsInput');
  if (assumptionsInput) {
    assumptionsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyAssumptionsFromUI();
      }
    });
  }

  // Clear Session Memory
  document.getElementById('btnClearMemory').addEventListener('click', clearSessionMemory);

  // Add Visual Math Cell Bottom
  document.getElementById('btnAddCellBottom').addEventListener('click', () => {
    addNewCellAfter(AppState.cells.length - 1, { mode: 'visual' });
  });

  // Add Direct SymPy Code Cell Bottom
  const btnAddCodeCellBottom = document.getElementById('btnAddCodeCellBottom');
  if (btnAddCodeCellBottom) {
    btnAddCodeCellBottom.addEventListener('click', () => {
      addNewCellAfter(AppState.cells.length - 1, {
        mode: 'code',
        code: '# Direct SymPy Code Mode (Python)\nx, y = sp.symbols("x y", real=True)\nresult = sp.expand((x + y)**3)'
      });
    });
  }

  // Evaluate All Cells
  document.getElementById('btnEvaluateAll').addEventListener('click', () => {
    evaluateAllCells();
  });

  // Save & Load JSON Notebook
  document.getElementById('btnSaveJson').addEventListener('click', downloadNotebookJson);
  document.getElementById('inputLoadJson').addEventListener('change', uploadNotebookJson);

  // Export Printable PDF / Clean HTML
  document.getElementById('btnExportPrint').addEventListener('click', exportPrintNotebook);

  // Preset Selector (templates open in a new tab unless the current tab is empty)
  document.getElementById('presetSelector').addEventListener('change', async (e) => {
    const val = e.target.value;
    if (!val || !PRESET_NOTEBOOKS[val]) return;
    const label = (e.target.selectedOptions[0]?.text || val).replace(/^\d+\.\s*/, '').replace(/\s*\(.*\)\s*$/, '');
    e.target.value = '';
    loadPresetNotebook(val, true, label);
  });

  // Multi-notebook tabs: new empty tab
  const btnNewTab = document.getElementById('btnNewNotebookTab');
  if (btnNewTab) {
    btnNewTab.addEventListener('click', () => {
      openNewTab('Untitled ' + (AppState.tabs.length + 1), PRESET_NOTEBOOKS.blank.map(c => createCellModel({ ...c })));
    });
  }

  // Dismiss Welcome Banner (persisted across reloads)
  const welcomeBannerEl = document.getElementById('welcomeBanner');
  try {
    if (welcomeBannerEl && localStorage.getItem('sympystudio_banner_dismissed_v1') === '1') {
      welcomeBannerEl.classList.add('hidden');
    }
  } catch (_) {}
  const dismissBtn = document.getElementById('btnDismissBanner');
  if (dismissBtn && welcomeBannerEl) {
    dismissBtn.addEventListener('click', () => {
      welcomeBannerEl.classList.add('hidden');
      try { localStorage.setItem('sympystudio_banner_dismissed_v1', '1'); } catch (_) {}
    });
  }

  // Return to Notebook Button from Documentation Tab
  const btnBackToNotebook = document.getElementById('btnBackToNotebook');
  if (btnBackToNotebook) {
    btnBackToNotebook.addEventListener('click', () => switchRibbonTab('tab-calculus'));
  }
}

async function applyAssumptionsFromUI() {
  const inputEl = document.getElementById('assumptionsSymbolsInput');
  if (!inputEl) return;
  const rawSyms = inputEl.value.trim();
  if (!rawSyms) return;

  const pos = document.getElementById('assumePositive')?.checked || false;
  const rl  = document.getElementById('assumeReal')?.checked || false;
  const itg = document.getElementById('assumeInteger')?.checked || false;
  const nz  = document.getElementById('assumeNonzero')?.checked || false;

  const names = rawSyms.split(/[,\s]+/).map(s => s.trim()).filter(s => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s));
  if (!names.length) return;

  names.forEach(nm => {
    AppState.symbolAssumptions[nm] = { positive: pos, real: rl, integer: itg, nonzero: nz };
  });

  if (AppState.kernelReady) {
    const payload = { symbols: names.join(', '), positive: pos, real: rl, integer: itg, nonzero: nz };
    const resJson = await Kernel.call('apply_symbol_assumptions', [JSON.stringify(payload)]);
    const parsed = JSON.parse(resJson);
    if (parsed.session) {
      updateVariableInspectorUI(parsed.session);
    }
  } else {
    renderAssumptionsBadgesFromState();
  }

  inputEl.value = '';
  saveNotebookToLocalStorage();
}

async function syncSavedAssumptionsToKernel() {
  if (!AppState.kernelReady) return;
  const entries = Object.entries(AppState.symbolAssumptions || {});
  for (const [symName, flagsObj] of entries) {
    const payload = {
      symbols: symName,
      positive: !!flagsObj.positive,
      real: !!flagsObj.real,
      integer: !!flagsObj.integer,
      nonzero: !!flagsObj.nonzero
    };
    const resJson = await Kernel.call('apply_symbol_assumptions', [JSON.stringify(payload)]);
    const parsed = JSON.parse(resJson);
    if (parsed.session) {
      updateVariableInspectorUI(parsed.session);
    }
  }
}

function renderAssumptionsBadgesFromState() {
  const container = document.getElementById('assumptionsActiveList');
  if (!container) return;
  const entries = Object.entries(AppState.symbolAssumptions || {});
  if (!entries.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = entries.map(([nm, fl]) => {
    const tags = [];
    if (fl.positive) tags.push('pos');
    if (fl.real) tags.push('real');
    if (fl.integer) tags.push('int');
    if (fl.nonzero) tags.push('≠0');
    return `<span class="px-1.5 py-0.5 rounded bg-blue-50 text-cobalt border border-blue-200 font-mono text-[10px]"><strong>${escapeHtml(nm)}</strong>: ${tags.join(', ') || 'complex'}</span>`;
  }).join('');
}

function switchRibbonTab(tabId) {
  document.querySelectorAll('.ribbon-tab').forEach(t => {
    const isMatch = t.getAttribute('data-tab') === tabId;
    t.classList.toggle('active', isMatch);
    t.classList.toggle('border-cobalt', isMatch);
    t.classList.toggle('text-cobalt', isMatch);
    t.classList.toggle('border-transparent', !isMatch);
    t.classList.toggle('text-muted', !isMatch);
  });

  document.querySelectorAll('.ribbon-panel').forEach(p => {
    if (p.id === tabId) {
      p.classList.remove('hidden');
      p.classList.add('flex');
    } else {
      p.classList.add('hidden');
      p.classList.remove('flex');
    }
  });

  // Toggle between Live Notebook View and Documentation View when Tab 7 (tab-docs) is selected
  const isDocs = tabId === 'tab-docs';
  const docView = document.getElementById('documentationView');
  const cellsContainer = document.getElementById('notebookCells');
  const bottomAddWrap = document.getElementById('bottomAddCellWrap');
  const welcomeBanner = document.getElementById('welcomeBanner');
  const tabsBar = document.getElementById('notebookTabsBar');
  const paletteDrawer = document.getElementById('mathPaletteDrawer');

  if (isDocs && docView && !docView.dataset.mathRendered && typeof renderMathInElement === 'function') {
    // Typeset the $...$ / $$...$$ math in the guide once, on first open
    renderMathInElement(docView, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
      ],
      throwOnError: false
    });
    docView.dataset.mathRendered = '1';
  }

  if (docView && cellsContainer && bottomAddWrap) {
    docView.classList.toggle('hidden', !isDocs);
    cellsContainer.classList.toggle('hidden', isDocs);
    bottomAddWrap.classList.toggle('hidden', isDocs);
    if (tabsBar) tabsBar.classList.toggle('hidden', isDocs);
    if (paletteDrawer) {
      paletteDrawer.classList.toggle('hidden', isDocs || !AppState.paletteOpen);
    }
    if (welcomeBanner && isDocs) {
      welcomeBanner.classList.add('hidden');
    }
  }
}

// ============================================================================
// NOTEBOOK CELL MANAGEMENT & RENDERING (DUAL-MODE: VISUAL MATH + SYMPY CODE)
// ============================================================================

function createCellModel(overrides = {}) {
  const id = overrides.id || 'cell_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const mode = overrides.mode === 'code' ? 'code' : 'visual';
  const op = normalizeOperationKey(overrides.operation || 'eval');
  const defaultParams = {};
  if (OPERATIONS[op]) {
    OPERATIONS[op].params.forEach(p => {
      defaultParams[p.key] = p.default;
    });
  }

  return {
    id,
    mode,
    title: overrides.title || '',
    latex: overrides.latex !== undefined ? overrides.latex : '',
    code: overrides.code !== undefined ? overrides.code : '',
    operation: op,
    params: { ...defaultParams, ...(overrides.params || {}) },
    assignTo: overrides.assignTo || '',
    inIndex: overrides.inIndex || null,
    execTimeMs: overrides.execTimeMs || null,
    output: overrides.output || null, // { status, latex, approxLatex, showDecimal, sympyCode, stdout, assigned, warning, plotData }
  };
}

function renderAllCells() {
  const container = document.getElementById('notebookCells');
  container.innerHTML = '';
  AppState.codeMirrors = {};

  AppState.cells.forEach((cell, idx) => {
    const wrapper = buildCellDOM(cell, idx);
    container.appendChild(wrapper);
  });

  if (!AppState.activeCellId && AppState.cells.length > 0) {
    setActiveCell(AppState.cells[0].id, false);
  } else if (AppState.activeCellId) {
    setActiveCell(AppState.activeCellId, false);
  }
}

function buildGroupedOperationOptions(selectedOp) {
  return OPERATION_GROUPS.map(grp => {
    const opts = Object.entries(OPERATIONS)
      .filter(([, v]) => v.group === grp.id)
      .map(([k, v]) => `<option value="${k}" ${selectedOp === k ? 'selected' : ''}>${v.label}</option>`)
      .join('');
    return opts ? `<optgroup label="${grp.label}">${opts}</optgroup>` : '';
  }).join('');
}

function buildCellDOM(cell, idx) {
  const wrapper = document.createElement('div');
  wrapper.className = 'notebook-cell-wrapper relative group';
  wrapper.dataset.cellId = cell.id;

  const isCodeMode = cell.mode === 'code';
  const card = document.createElement('article');
  card.className = `notebook-cell p-3.5 sm:p-4 ${isCodeMode ? 'code-mode-cell' : ''} ${AppState.activeCellId === cell.id ? 'active-cell' : ''}`;
  card.id = `dom_${cell.id}`;

  const inLabel = cell.inIndex ? `In [${cell.inIndex}]:` : `In [ ]:`;
  const timeBadge = cell.execTimeMs !== null
    ? `<span class="text-[11px] font-mono text-emerald bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">${cell.execTimeMs} ms</span>`
    : '';

  const opOptionsHtml = buildGroupedOperationOptions(cell.operation);
  const inlineTitleHtml = cell.title
    ? `<span class="text-xs font-serif font-semibold text-ink truncate max-w-[260px] sm:max-w-[440px]" title="${escapeHtml(cell.title)}">${escapeHtml(cell.title)}</span>`
    : `<span class="cell-mode-label text-[11px] font-mono text-muted ${isCodeMode ? 'inline' : 'hidden'}">Python / SymPy Script</span>`;

  card.innerHTML = `
    <!-- 1. Compact Cell Header Bar with Inline Title & Dual-Mode Controls -->
    <div class="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mb-2 pb-1.5 border-b border-borderWarm/70">
      <div class="flex items-center gap-1.5 sm:gap-2 min-w-0">
        <span class="cell-drag-handle cursor-grab text-muted hover:text-ink print-hidden shrink-0" title="Move Cell Up/Down">
          <button class="btn-move-up hover:text-cobalt px-0.5" title="Move Cell Up">&uarr;</button>
          <button class="btn-move-down hover:text-cobalt px-0.5" title="Move Cell Down">&darr;</button>
        </span>
        <span class="cell-in-badge font-mono font-semibold text-xs text-cobalt bg-blue-50/80 px-1.5 sm:px-2 py-0.5 rounded border border-blue-200/80 select-none shrink-0">
          ${inLabel}
        </span>
        ${inlineTitleHtml}
      </div>

      <div class="flex flex-wrap items-center gap-1 sm:gap-1.5 print-hidden ml-auto shrink-0">
        <!-- Dual-Mode Toggle Pill -->
        <div class="inline-flex rounded-md bg-subtle p-0.5 border border-borderWarm text-[11px] font-medium">
          <button type="button" class="btn-mode-visual px-2 py-0.5 rounded transition ${!isCodeMode ? 'bg-surface text-cobalt shadow-2xs font-semibold' : 'text-muted hover:text-ink'}" title="Visual MathLive Equation Mode">
            Visual Math
          </button>
          <button type="button" class="btn-mode-code px-2 py-0.5 rounded font-mono transition ${isCodeMode ? 'bg-zinc-900 text-emerald-400 shadow-2xs font-semibold' : 'text-muted hover:text-ink'}" title="Direct SymPy Python Script Mode">
            SymPy Code
          </button>
        </div>

        <!-- Compact Bi-Directional Sync Button -->
        <button type="button" class="btn-convert-to-code ${isCodeMode ? 'hidden' : 'inline-flex'} items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white border border-emerald-200 transition" title="Generate Editable SymPy Python Script from Visual Equation + Operation">
          <span>&#8644; Sync Code</span>
        </button>

        <button type="button" class="btn-convert-to-visual ${isCodeMode ? 'inline-flex' : 'hidden'} items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono font-medium bg-blue-50 text-cobalt hover:bg-cobalt hover:text-white border border-blue-200 transition" title="Parse SymPy Code back into Visual Math Equation">
          <span>&#8644; Sync Math</span>
        </button>

        <span class="cell-time-badge hidden sm:inline">${timeBadge}</span>
        <button class="btn-delete-cell text-muted hover:text-red-600 p-1 rounded hover:bg-red-50 transition" title="Delete Cell">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <!-- 2A. Visual MathLive Input Zone -->
    <div class="visual-input-zone mb-2.5 ${isCodeMode ? 'hidden' : ''}">
      <math-field id="mf_${cell.id}"></math-field>
    </div>

    <!-- 2B. Direct SymPy Code Input Zone (CodeMirror / Python Script) -->
    <div class="code-input-zone mb-2.5 ${isCodeMode ? '' : 'hidden'}">
      <div class="code-editor-wrapper">
        <textarea id="cm_${cell.id}" class="code-fallback-textarea" spellcheck="false" placeholder="# Enter multi-line Python / SymPy code...&#10;# Assign 'result = ...' or end with an expression on the last line to render in KaTeX."></textarea>
      </div>
      <!-- Live Visual Math rendering of the typed code (updates as you type) -->
      <div class="code-visual-preview mt-1.5 rounded-md border border-blue-200/80 bg-blue-50/40 hidden">
        <div class="flex items-center justify-between px-2.5 py-1 border-b border-blue-200/70 text-[10px] font-mono uppercase tracking-wider text-cobalt select-none">
          <span>&Sigma; Live Symbolic Preview <span class="normal-case text-muted font-normal">(assign <code class="text-cobalt">result</code> or final expression; <code class="text-emerald">print()</code> streams to stdout)</span></span>
          <span class="code-preview-status normal-case tracking-normal text-muted"></span>
        </div>
        <div class="code-preview-body px-3 py-1.5 space-y-1 overflow-x-auto text-sm"></div>
      </div>
    </div>

    <!-- 3. Execution Controls & Parameter Bar -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-0.5 text-xs print-hidden">
      <div class="visual-controls-bar flex flex-wrap items-center gap-1.5 sm:gap-2 ${isCodeMode ? 'hidden' : ''}">
        <!-- Grouped Operation Selector -->
        <select class="cell-op-select w-full sm:w-auto bg-subtle hover:bg-zinc-200/60 text-ink font-medium rounded px-2.5 py-1 border border-borderWarm focus:outline-none focus:border-cobalt cursor-pointer" title="Select Symbolic Operation">
          ${opOptionsHtml}
        </select>

        <!-- Dynamic Operation Parameters Container -->
        <div class="cell-params-container flex flex-wrap items-center gap-1.5"></div>
      </div>

      <div class="flex items-center justify-between sm:justify-end gap-2 sm:ml-auto w-full sm:w-auto">
        <!-- Assign to Variable Optional Field -->
        <label class="flex items-center gap-1.5 bg-subtle/70 px-2 py-1 rounded border border-borderWarm text-muted" title="Optional: Store output in a session variable">
          <span class="text-[11px] font-mono">Assign:</span>
          <input type="text" class="cell-assign-input w-16 sm:w-20 bg-surface px-1.5 py-0.5 rounded border border-borderWarm font-mono text-xs text-ink focus:outline-none focus:border-cobalt" placeholder="e.g. Sol1" value="${cell.assignTo || ''}" />
        </label>

        <!-- Evaluate Button -->
        <button class="btn-evaluate-cell px-3.5 py-1 rounded-md bg-cobalt hover:bg-blue-800 text-white font-semibold shadow-2xs transition flex items-center gap-1.5 ml-auto sm:ml-0" title="Evaluate Cell (Shift + Enter)">
          <span>${isCodeMode ? 'Run Script' : 'Evaluate'}</span>
          <kbd class="text-[10px] font-mono bg-blue-900/60 px-1 rounded hidden sm:inline">Shift+&crarr;</kbd>
        </button>
      </div>
    </div>

    <!-- 4. Output Zone (Out [n]:) -->
    <div class="cell-output-zone mt-2.5 ${cell.output ? '' : 'hidden'}"></div>
  `;

  wrapper.appendChild(card);

  // 5. Floating "+ Add Cell" Divider below each cell
  const addDivider = document.createElement('div');
  addDivider.className = 'cell-divider-add flex justify-center gap-2 -my-1.5 z-10 relative print-hidden';
  addDivider.innerHTML = `
    <button class="btn-insert-below px-2.5 py-0.5 rounded-full bg-surface hover:bg-cobalt text-muted hover:text-white border border-borderWarm text-[11px] font-medium shadow-2xs transition">
      + Add Visual Cell Below
    </button>
    <button class="btn-insert-code-below px-2.5 py-0.5 rounded-full bg-zinc-900 hover:bg-cobalt text-zinc-200 hover:text-white border border-zinc-700 text-[11px] font-mono font-medium shadow-2xs transition">
      + Add SymPy Code Cell
    </button>
  `;
  wrapper.appendChild(addDivider);

  // Initialize MathLive field value & listeners
  const mf = card.querySelector(`#mf_${cell.id}`);
  mf.value = cell.latex || '';

  mf.addEventListener('focus', () => {
    setActiveCell(cell.id, false);
  });

  mf.addEventListener('input', () => {
    cell.latex = mf.value;
    saveNotebookToLocalStorage();
  });

  // Shift + Enter to evaluate, Up/Down arrow navigation between cells
  mf.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && ev.shiftKey) {
      ev.preventDefault();
      ev.stopPropagation();
      evaluateCell(cell.id);
    } else if (ev.key === 'ArrowUp' && ev.altKey) {
      ev.preventDefault();
      if (idx > 0) setActiveCell(AppState.cells[idx - 1].id, true);
    } else if (ev.key === 'ArrowDown' && ev.altKey) {
      ev.preventDefault();
      if (idx < AppState.cells.length - 1) setActiveCell(AppState.cells[idx + 1].id, true);
    }
  });

  // Initialize CodeMirror or Fallback Textarea for Direct SymPy Code Mode
  const rawTextarea = card.querySelector(`#cm_${cell.id}`);
  rawTextarea.value = cell.code || '';
  if (isCodeMode) {
    initCodeEditorForCell(cell, rawTextarea);
    scheduleCodePreview(cell, 50);
  } else {
    rawTextarea.addEventListener('input', () => {
      cell.code = rawTextarea.value;
      saveNotebookToLocalStorage();
    });
  }

  // Mode Toggle Listeners (Visual Math <-> Direct SymPy Code)
  card.querySelector('.btn-mode-visual').addEventListener('click', async () => {
    if (cell.mode !== 'visual') {
      await convertCodeCellToVisualMath(cell, card);
    }
  });
  card.querySelector('.btn-mode-code').addEventListener('click', () => {
    if (cell.mode !== 'code') {
      switchCellMode(cell, card, 'code');
    }
  });

  // Bi-Directional Bridge Buttons ("Convert to SymPy Code" <-> "Convert to Visual Math")
  card.querySelector('.btn-convert-to-code').addEventListener('click', async () => {
    await convertVisualCellToSympyCode(cell, card);
  });
  const btnToVisual = card.querySelector('.btn-convert-to-visual');
  if (btnToVisual) {
    btnToVisual.addEventListener('click', async () => {
      await convertCodeCellToVisualMath(cell, card);
    });
  }

  // Card click activates cell
  card.addEventListener('mousedown', () => {
    setActiveCell(cell.id, false);
  });

  // Operation Selector Change
  const opSelect = card.querySelector('.cell-op-select');
  opSelect.addEventListener('change', () => {
    const newOp = normalizeOperationKey(opSelect.value);
    cell.operation = newOp;
    const opMeta = OPERATIONS[newOp];
    if (opMeta) {
      opMeta.params.forEach(p => {
        if (cell.params[p.key] === undefined) {
          cell.params[p.key] = p.default;
        }
      });
    }
    renderCellParams(card, cell);
    saveNotebookToLocalStorage();
  });

  // Render initial operation parameters
  renderCellParams(card, cell);

  // Assign To input
  const assignInput = card.querySelector('.cell-assign-input');
  assignInput.addEventListener('input', () => {
    cell.assignTo = assignInput.value.trim();
    saveNotebookToLocalStorage();
  });
  assignInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      evaluateCell(cell.id);
    }
  });

  // Evaluate button
  card.querySelector('.btn-evaluate-cell').addEventListener('click', () => {
    if (AppState.runningCellId === cell.id) {
      AppState.stopRunAll = true;
      Kernel.interrupt();
      return;
    }
    evaluateCell(cell.id);
  });

  // Move Up / Down / Delete Cell
  card.querySelector('.btn-move-up').addEventListener('click', (e) => {
    e.stopPropagation();
    moveCell(idx, -1);
  });
  card.querySelector('.btn-move-down').addEventListener('click', (e) => {
    e.stopPropagation();
    moveCell(idx, 1);
  });
  card.querySelector('.btn-delete-cell').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteCell(cell.id);
  });

  // Insert Visual or Code Cell Below
  addDivider.querySelector('.btn-insert-below').addEventListener('click', () => {
    addNewCellAfter(idx, { mode: 'visual' });
  });
  addDivider.querySelector('.btn-insert-code-below').addEventListener('click', () => {
    addNewCellAfter(idx, {
      mode: 'code',
      code: '# Direct SymPy Code Mode\nresult = '
    });
  });

  // Render existing output if present
  if (cell.output) {
    renderCellOutput(card, cell);
  }

  return wrapper;
}

function initCodeEditorForCell(cell, textareaEl) {
  if (!textareaEl) return;
  if (AppState.codeMirrors[cell.id]) {
    setTimeout(() => AppState.codeMirrors[cell.id].refresh(), 10);
    return;
  }

  if (typeof CodeMirror !== 'undefined') {
    const cm = CodeMirror.fromTextArea(textareaEl, {
      mode: 'python',
      lineNumbers: true,
      indentUnit: 4,
      tabSize: 4,
      indentWithTabs: false,
      lineWrapping: true,
      viewportMargin: Infinity,
      extraKeys: {
        'Shift-Enter': () => evaluateCell(cell.id),
        'Cmd-Enter': () => evaluateCell(cell.id),
        'Ctrl-Enter': () => evaluateCell(cell.id),
        Tab: (cmInst) => {
          if (cmInst.somethingSelected()) {
            cmInst.indentSelection('add');
          } else {
            cmInst.replaceSelection('    ', 'end');
          }
        }
      }
    });
    cm.on('change', () => {
      cell.code = cm.getValue();
      saveNotebookToLocalStorage();
      scheduleCodePreview(cell);
    });
    cm.on('focus', () => {
      setActiveCell(cell.id, false);
    });
    AppState.codeMirrors[cell.id] = cm;
    setTimeout(() => cm.refresh(), 15);
  } else {
    // Fallback textarea listeners if CodeMirror CDN is unavailable
    textareaEl.addEventListener('input', () => {
      cell.code = textareaEl.value;
      saveNotebookToLocalStorage();
      scheduleCodePreview(cell);
    });
    textareaEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.shiftKey) {
        ev.preventDefault();
        evaluateCell(cell.id);
      }
    });
  }
}

// ----------------------------------------------------------------------------
// LIVE CODE -> VISUAL MATH PREVIEW
// Every assignment typed in a SymPy code cell is rendered as a KaTeX equation
// (heavy calls like integrate/solve are shown unevaluated, nothing is persisted).
// ----------------------------------------------------------------------------
function scheduleCodePreview(cell, delayMs = 550) {
  if (!cell || cell.mode !== 'code') return;
  clearTimeout(AppState.previewTimers[cell.id]);
  AppState.previewTimers[cell.id] = setTimeout(() => refreshCodePreview(cell), delayMs);
}

async function refreshCodePreview(cell) {
  const card = document.getElementById(`dom_${cell.id}`);
  if (!card || cell.mode !== 'code') return;
  const panel = card.querySelector('.code-visual-preview');
  const bodyEl = card.querySelector('.code-preview-body');
  const statusEl = card.querySelector('.code-preview-status');
  if (!panel || !bodyEl) return;

  if (!(cell.code || '').trim()) {
    panel.classList.add('hidden');
    return;
  }
  if (!AppState.kernelReady) {
    panel.classList.remove('hidden');
    statusEl.textContent = 'waiting for kernel…';
    return;
  }
  if (AppState.kernelBusy) {
    scheduleCodePreview(cell, 400); // retry once the kernel is idle
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(await Kernel.call('code_visual_preview', [cell.code]));
  } catch (e) {
    parsed = { status: 'error', message: e.message || String(e), rows: [] };
  }

  panel.classList.remove('hidden');
  bodyEl.innerHTML = '';
  if (parsed.status !== 'ok') {
    statusEl.textContent = '';
    bodyEl.innerHTML = `<p class="text-[11px] font-mono text-amber-800">${escapeHtml(parsed.message || 'Could not preview code.')}</p>`;
    return;
  }
  const rows = parsed.rows || [];
  statusEl.textContent = rows.length ? `${rows.length} equation${rows.length > 1 ? 's' : ''}` : '';
  if (!rows.length) {
    bodyEl.innerHTML = `<p class="text-[11px] font-mono text-muted italic">No assignments to visualise yet (symbol declarations, loops and prints are skipped).</p>`;
    return;
  }
  rows.forEach(row => {
    const line = document.createElement('div');
    line.className = 'code-preview-row';
    const tex = '\\displaystyle ' + (row.lhs ? `${row.lhs} = ${row.latex}` : row.latex);
    try {
      katex.render(tex, line, { displayMode: false, throwOnError: false });
    } catch (e) {
      line.textContent = tex;
    }
    bodyEl.appendChild(line);
  });
}

function switchCellMode(cell, card, targetMode) {
  cell.mode = targetMode;
  const isCode = targetMode === 'code';

  card.classList.toggle('code-mode-cell', isCode);
  card.querySelector('.visual-input-zone').classList.toggle('hidden', isCode);
  card.querySelector('.code-input-zone').classList.toggle('hidden', !isCode);
  card.querySelector('.visual-controls-bar').classList.toggle('hidden', isCode);
  card.querySelector('.btn-convert-to-code').classList.toggle('hidden', isCode);
  card.querySelector('.btn-convert-to-code').classList.toggle('inline-flex', !isCode);

  const btnConvertToVisual = card.querySelector('.btn-convert-to-visual');
  if (btnConvertToVisual) {
    btnConvertToVisual.classList.toggle('hidden', !isCode);
    btnConvertToVisual.classList.toggle('inline-flex', isCode);
  }

  const btnVis = card.querySelector('.btn-mode-visual');
  const btnCod = card.querySelector('.btn-mode-code');
  btnVis.className = `btn-mode-visual px-2 py-0.5 rounded transition ${!isCode ? 'bg-surface text-cobalt shadow-2xs font-semibold' : 'text-muted hover:text-ink'}`;
  btnCod.className = `btn-mode-code px-2 py-0.5 rounded font-mono transition ${isCode ? 'bg-zinc-900 text-emerald-400 shadow-2xs font-semibold' : 'text-muted hover:text-ink'}`;

  const evalBtnSpan = card.querySelector('.btn-evaluate-cell span');
  if (evalBtnSpan) evalBtnSpan.textContent = isCode ? 'Run Script' : 'Evaluate';

  const modeLabel = card.querySelector('.cell-mode-label');
  if (modeLabel) {
    modeLabel.classList.toggle('hidden', !isCode);
    modeLabel.classList.toggle('inline', isCode);
  }

  if (isCode) {
    const textareaEl = card.querySelector(`#cm_${cell.id}`);
    if (!cell.code && cell.latex) {
      convertVisualCellToSympyCode(cell, card);
      return;
    }
    initCodeEditorForCell(cell, textareaEl);
    scheduleCodePreview(cell, 50);
    if (AppState.codeMirrors[cell.id]) {
      setTimeout(() => {
        AppState.codeMirrors[cell.id].refresh();
        AppState.codeMirrors[cell.id].focus();
      }, 20);
    }
  } else {
    const mf = card.querySelector(`#mf_${cell.id}`);
    if (mf && cell.latex !== undefined) {
      mf.value = cell.latex;
    }
  }
  saveNotebookToLocalStorage();
}

async function convertVisualCellToSympyCode(cell, card) {
  const mf = document.getElementById(`mf_${cell.id}`);
  if (mf) cell.latex = mf.value;

  let generatedCode = '';
  if (AppState.kernelReady) {
    try {
      const payload = {
        latex: cell.latex,
        operation: cell.operation,
        params: cell.params,
        assignTo: cell.assignTo
      };
      const resJson = await Kernel.call('convert_visual_to_sympy_code', [JSON.stringify(payload)]);
      const parsed = JSON.parse(resJson);
      if (parsed.status === 'ok' && parsed.code) {
        generatedCode = parsed.code;
      }
    } catch (e) {
      console.warn('Fallback conversion used:', e);
    }
  }

  if (!generatedCode) {
    const fallbackExpr = cell.output?.sympyCode || cell.latex || '0';
    generatedCode = `# Converted from Visual Math Mode\nresult = ${fallbackExpr}`;
  }

  cell.code = generatedCode;
  const textareaEl = card.querySelector(`#cm_${cell.id}`);
  if (textareaEl) textareaEl.value = generatedCode;
  if (AppState.codeMirrors[cell.id]) {
    AppState.codeMirrors[cell.id].setValue(generatedCode);
  }
  switchCellMode(cell, card, 'code');
}

async function convertCodeCellToVisualMath(cell, card) {
  // Sync latest code from CodeMirror / Textarea
  if (AppState.codeMirrors[cell.id]) {
    cell.code = AppState.codeMirrors[cell.id].getValue();
  } else {
    const rawTextarea = card.querySelector(`#cm_${cell.id}`);
    if (rawTextarea) cell.code = rawTextarea.value;
  }

  if (AppState.kernelReady && (cell.code || '').trim()) {
    try {
      const resJson = await Kernel.call('convert_code_to_visual', [cell.code]);
      const parsed = JSON.parse(resJson);
      if (parsed.status === 'ok') {
        if (parsed.latex) cell.latex = parsed.latex;
        if (parsed.operation) cell.operation = parsed.operation;
        if (parsed.params && Object.keys(parsed.params).length) {
          cell.params = { ...cell.params, ...parsed.params };
        }
        if (parsed.assignTo !== undefined) cell.assignTo = parsed.assignTo;
      }
    } catch (e) {
      console.warn('Code to visual conversion error:', e);
    }
  }

  // Update MathLive field
  const mf = card.querySelector(`#mf_${cell.id}`);
  if (mf) mf.value = cell.latex || '';

  // Update Operation dropdown & parameters
  const opSelect = card.querySelector('.cell-op-select');
  if (opSelect && cell.operation) {
    opSelect.value = cell.operation;
  }
  renderCellParams(card, cell);

  // Update Assign input
  const assignInput = card.querySelector('.cell-assign-input');
  if (assignInput) {
    assignInput.value = cell.assignTo || '';
  }

  switchCellMode(cell, card, 'visual');
  saveNotebookToLocalStorage();
}

function renderCellParams(card, cell) {
  const container = card.querySelector('.cell-params-container');
  container.innerHTML = '';
  const opMeta = OPERATIONS[cell.operation];
  if (!opMeta || !opMeta.params.length) return;

  opMeta.params.forEach(p => {
    const val = cell.params[p.key] !== undefined ? cell.params[p.key] : p.default;
    cell.params[p.key] = val;

    const wrap = document.createElement('label');
    wrap.className = 'flex items-center gap-1 bg-subtle/80 px-2 py-1 rounded border border-borderWarm text-muted';

    if (p.type === 'select') {
      const opts = p.options.map(o => `<option value="${o.value}" ${o.value === val ? 'selected' : ''}>${o.text}</option>`).join('');
      wrap.innerHTML = `
        <span class="text-[11px] font-mono">${p.label}:</span>
        <select data-param="${p.key}" class="bg-surface px-1.5 py-0.5 rounded border border-borderWarm font-mono text-xs text-ink focus:outline-none focus:border-cobalt">
          ${opts}
        </select>
      `;
    } else {
      wrap.innerHTML = `
        <span class="text-[11px] font-mono">${p.label}:</span>
        <input type="${p.type}" data-param="${p.key}" value="${val}" class="${p.width || 'w-16'} bg-surface px-1.5 py-0.5 rounded border border-borderWarm font-mono text-xs text-ink focus:outline-none focus:border-cobalt" />
      `;
    }

    const inputEl = wrap.querySelector('[data-param]');
    const onParamChange = () => {
      cell.params[p.key] = inputEl.value;
      // Ergonomic auto-sync: when curvilinear coordinate system changes, update default coords string automatically
      if (p.key === 'system' && COORD_SYSTEM_DEFAULTS[inputEl.value]) {
        const coordsInput = container.querySelector('[data-param="coords"]');
        const currentCoords = (cell.params.coords || '').trim();
        const defaultCoordSet = Object.values(COORD_SYSTEM_DEFAULTS);
        if (!currentCoords || defaultCoordSet.includes(currentCoords)) {
          const nextCoords = COORD_SYSTEM_DEFAULTS[inputEl.value];
          cell.params.coords = nextCoords;
          if (coordsInput) coordsInput.value = nextCoords;
        }
      }
      saveNotebookToLocalStorage();
    };
    inputEl.addEventListener('input', onParamChange);
    if (p.type === 'select') {
      inputEl.addEventListener('change', onParamChange);
    }
    inputEl.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        evaluateCell(cell.id);
      }
    });

    container.appendChild(wrap);
  });
}

function formatAsAlignStarLatex(cell, activeLatex) {
  const trimmed = (activeLatex || '').trim();
  if (trimmed.startsWith('\\begin{align')) {
    return trimmed;
  }
  if (trimmed.startsWith('\\begin{aligned}')) {
    const body = trimmed.replace(/^\\begin\{aligned\}/, '').replace(/\\end\{aligned\}$/, '').trim();
    return `\\begin{align*}\n  ${body}\n\\end{align*}`;
  }
  const lhs = cell.assignTo
    ? `${cell.assignTo} &= `
    : (cell.mode === 'visual' && cell.latex && !cell.latex.includes('=') ? `${cell.latex} &= ` : '');
  const splitTerms = trimmed.replace(/\s+\+\s+/g, ' \\\\\n  &+ ');
  return `\\begin{align*}\n  ${lhs}${splitTerms}\n\\end{align*}`;
}

function renderCellOutput(card, cell) {
  const outZone = card.querySelector('.cell-output-zone');
  const out = cell.output;
  if (!out) {
    outZone.classList.add('hidden');
    outZone.innerHTML = '';
    return;
  }

  outZone.classList.remove('hidden');

  if (out.status === 'error') {
    const errStdout = out.stdout
      ? `<pre class="mt-2 p-2 rounded bg-zinc-900 text-zinc-200 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">${escapeHtml(out.stdout)}</pre>`
      : '';
    outZone.innerHTML = `
      <div class="p-3 rounded-lg bg-amber-50/90 border border-amber-300 text-amber-900 text-xs flex items-start gap-2.5">
        <svg class="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        <div class="flex-1 min-w-0">
          <p class="font-semibold">${out.interrupted ? 'Computation stopped' : 'Symbolic Evaluation Notice'}</p>
          <p class="mt-0.5 font-mono text-[11px] opacity-90">${escapeHtml(out.message)}</p>
          ${(out.parseWarnings || []).map(w => `<p class="mt-1 text-[11px]">&#9888; ${escapeHtml(w)}</p>`).join('')}
          ${errStdout}
          ${out.interrupted ? '' : '<p class="mt-1 text-[11px] text-amber-800">Check syntax, parentheses, or symbol definitions.</p>'}
        </div>
      </div>
    `;
    return;
  }

  const outIndexLabel = cell.inIndex ? `Out [${cell.inIndex}]:` : 'Out:';
  const assignedBadge = out.assigned
    ? `<span class="text-[11px] font-mono bg-orange-50 text-terracotta border border-orange-200 px-2 py-0.5 rounded">Assigned &rarr; <strong>${escapeHtml(out.assigned)}</strong></span>`
    : '';

  const warningHtml = [out.warning, ...(out.parseWarnings || [])].filter(Boolean).map(w =>
    `<div class="mb-2 px-2.5 py-1.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-center gap-1.5">
       <span>&#9888;</span> <span>${escapeHtml(w)}</span>
     </div>`).join('');

  const parsedHtml = out.parsedLatex
    ? `<div class="parsed-as-row mb-2 flex items-center gap-2 text-[11px] text-muted" title="How the input was understood. If this is not what you meant, edit the input.">
         <span class="font-mono uppercase tracking-wider shrink-0">Parsed as</span>
         <span class="parsed-as-katex min-w-0 overflow-x-auto overflow-y-hidden py-1 text-ink text-sm"></span>
       </div>`
    : '';

  const activeLatex = out.showDecimal && out.approxLatex ? out.approxLatex : out.latex;

  // Collapsible Terminal Log for print() and sp.pprint()
  const stdoutHtml = out.stdout && out.stdout.trim()
    ? `<details open class="mt-2.5 group">
         <summary class="cursor-pointer text-[11px] font-mono text-emerald-800 bg-emerald-50/80 border border-emerald-200/80 px-2.5 py-1 rounded-t select-none flex items-center justify-between">
           <span>&#9656; Terminal Output Log (print / sp.pprint)</span>
           <span class="text-[10px] uppercase tracking-wider opacity-75">stdout</span>
         </summary>
         <pre class="p-3 rounded-b bg-zinc-950 text-emerald-300 font-mono text-xs overflow-x-auto leading-relaxed whitespace-pre">${escapeHtml(out.stdout)}</pre>
       </details>`
    : '';

  // Interactive Parameter Explorer Sliders (when unbound parameters are detected in plot)
  const slidersList = out.plotData?.sliderParams || [];
  const slidersHtml = slidersList.length > 0
    ? `<div class="mb-2 p-2.5 rounded-lg bg-subtle/70 border border-borderWarm print-hidden">
         <div class="flex items-center justify-between mb-1.5">
           <span class="text-[11px] font-mono font-semibold uppercase tracking-wider text-cobalt">Interactive Parameter Explorer (Real-Time sp.lambdify)</span>
           <span class="text-[10px] font-mono text-muted">Drag sliders to update plot</span>
         </div>
         <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
           ${slidersList.map(sl => `
             <label class="flex flex-col gap-1 bg-surface p-2 rounded border border-borderWarm text-xs">
               <div class="flex items-center justify-between font-mono text-[11px]">
                 <span class="font-semibold text-ink">${escapeHtml(sl.name)}</span>
                 <span class="slider-val-badge text-cobalt font-bold" data-slider-val="${escapeHtml(sl.name)}">${sl.value}</span>
               </div>
               <input type="range" class="param-explorer-slider accent-cobalt cursor-pointer"
                 data-param-name="${escapeHtml(sl.name)}"
                 min="${sl.min}" max="${sl.max}" step="${sl.step}" value="${sl.value}" />
             </label>
           `).join('')}
         </div>
       </div>`
    : '';

  outZone.innerHTML = `
    <div class="pt-3 border-t border-borderWarm/80">
      ${parsedHtml}
      ${warningHtml}
      <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div class="flex items-center gap-2">
          <span class="font-mono font-semibold text-xs text-terracotta bg-orange-50/90 px-2 py-0.5 rounded border border-orange-200/80 select-none">
            ${outIndexLabel}
          </span>
          ${assignedBadge}
          ${out.showDecimal ? '<span class="text-[10px] font-mono uppercase bg-subtle text-muted px-1.5 py-0.5 rounded">Decimal Approx (sp.N)</span>' : ''}
        </div>

        <!-- Output Action Toolbar -->
        <div class="flex flex-wrap items-center gap-1.5 print-hidden">
          <button class="btn-toggle-decimal px-2 py-1 rounded text-[11px] font-medium ${out.showDecimal ? 'bg-cobalt text-white' : 'bg-subtle hover:bg-zinc-200 text-ink'} border border-borderWarm transition" title="Toggle High-Precision Floating Point Approximation via sp.N()">
            ${out.showDecimal ? 'Exact Symbolic' : 'Decimal / Float (sp.N)'}
          </button>
          <button class="btn-copy-latex px-2 py-1 rounded text-[11px] font-medium bg-subtle hover:bg-zinc-200 text-ink border border-borderWarm transition" title="Copy Inline LaTeX to Clipboard">
            Copy LaTeX
          </button>
          <button class="btn-copy-align px-2 py-1 rounded text-[11px] font-mono font-medium bg-subtle hover:bg-zinc-200 text-ink border border-borderWarm transition" title="Copy Formatted multi-line LaTeX align* Environment">
            Copy align*
          </button>
          <button class="btn-plot-result px-2 py-1 rounded text-[11px] font-medium bg-blue-50 hover:bg-cobalt text-cobalt hover:text-white border border-blue-200 transition" title="Send Output Expression to Function Plotter">
            Plot Result
          </button>
        </div>
      </div>

      <!-- Rendered KaTeX Formula -->
      <div class="katex-output-container px-3 py-2 bg-paper/60 rounded-md border border-borderWarm/60 my-1"></div>

      <!-- Terminal Stdout / sp.pprint Drawer -->
      ${stdoutHtml}

      <!-- Optional Plotly Canvas Container + Interactive Sliders -->
      <div class="plotly-output-container ${out.plotData ? 'mt-3 p-2 sm:p-2.5 bg-surface border border-borderWarm rounded-lg' : 'hidden'}">
        ${slidersHtml}
        <div id="plot_${cell.id}" class="w-full h-72 sm:h-96"></div>
      </div>

      <!-- Collapsible Accordion: Show Equivalent SymPy Code -->
      <details class="mt-2 group print-hidden">
        <summary class="cursor-pointer text-[11px] font-mono text-muted hover:text-ink select-none flex items-center gap-1">
          <span>&#9656; Show Equivalent SymPy Code</span>
        </summary>
        <div class="mt-1.5 p-2.5 rounded bg-zinc-900 text-zinc-100 font-mono text-xs overflow-x-auto flex items-center justify-between">
          <pre class="whitespace-pre-wrap">${escapeHtml(out.sympyCode || '')}</pre>
        </div>
      </details>
    </div>
  `;

  const parsedBox = outZone.querySelector('.parsed-as-katex');
  if (parsedBox) {
    try {
      katex.render(out.parsedLatex, parsedBox, { displayMode: false, throwOnError: false });
    } catch (e) {
      parsedBox.textContent = out.parsedLatex;
    }
  }

  // Render KaTeX
  const katexBox = outZone.querySelector('.katex-output-container');
  try {
    katex.render(activeLatex, katexBox, {
      displayMode: true,
      throwOnError: false
    });
  } catch (e) {
    katexBox.textContent = activeLatex;
  }

  // Render Plotly 2D / Parametric / 3D / Vector Field if present
  if (out.plotData) {
    setTimeout(() => {
      renderPlotlyChart(`plot_${cell.id}`, out.plotData);
    }, 20);
  }

  // Bind Interactive Parameter Explorer Sliders
  const sliderInputs = outZone.querySelectorAll('.param-explorer-slider');
  if (sliderInputs.length > 0) {
    sliderInputs.forEach(inp => {
      inp.addEventListener('input', async () => {
        const paramValues = {};
        outZone.querySelectorAll('.param-explorer-slider').forEach(sEl => {
          const pName = sEl.getAttribute('data-param-name');
          const pVal = parseFloat(sEl.value);
          paramValues[pName] = pVal;
          const badge = outZone.querySelector(`[data-slider-val="${pName}"]`);
          if (badge) badge.textContent = pVal.toFixed(2);
        });
        await recomputePlotWithSliders(cell, paramValues);
      });
    });
  }

  // Decimal / Float Toggle
  const decBtn = outZone.querySelector('.btn-toggle-decimal');
  if (decBtn) {
    decBtn.addEventListener('click', () => {
      out.showDecimal = !out.showDecimal;
      renderCellOutput(card, cell);
    });
  }

  // Copy LaTeX Button
  const copyBtn = outZone.querySelector('.btn-copy-latex');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(activeLatex);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy LaTeX'; }, 1400);
    });
  }

  // Copy as LaTeX align* Button
  const copyAlignBtn = outZone.querySelector('.btn-copy-align');
  if (copyAlignBtn) {
    copyAlignBtn.addEventListener('click', () => {
      const alignLatex = formatAsAlignStarLatex(cell, activeLatex);
      navigator.clipboard.writeText(alignLatex);
      copyAlignBtn.textContent = 'Copied align*!';
      setTimeout(() => { copyAlignBtn.textContent = 'Copy align*'; }, 1400);
    });
  }

  // Plot This Result Button
  const plotBtn = outZone.querySelector('.btn-plot-result');
  if (plotBtn) {
    plotBtn.addEventListener('click', () => {
      const idx = AppState.cells.findIndex(c => c.id === cell.id);
      const refLatex = cell.inIndex ? `%${cell.inIndex}` : out.latex;
      const is3D = out.latex.includes('y') && out.latex.includes('x');
      const newCell = addNewCellAfter(idx, {
        mode: 'visual',
        latex: refLatex,
        operation: is3D ? 'plot_3d' : 'plot_2d'
      });
      switchRibbonTab('tab-plotter');
      evaluateCell(newCell.id);
    });
  }
}

async function recomputePlotWithSliders(cell, paramValues) {
  if (!AppState.kernelReady) return;
  try {
    const payload = {
      latex: cell.latex,
      operation: cell.operation,
      params: cell.params,
      paramValues
    };
    const rawRes = await Kernel.call('recompute_plot_with_params', [JSON.stringify(payload)], { timeLimit: getTimeLimitSeconds() });
    const parsed = JSON.parse(rawRes);
    if (parsed.status === 'ok' && parsed.plotData) {
      cell.output.plotData = parsed.plotData;
      renderPlotlyChart(`plot_${cell.id}`, parsed.plotData, true);
    }
  } catch (e) {
    console.warn('Slider live update error:', e);
  }
}

function renderPlotlyChart(containerId, plotData, isUpdate = false) {
  const el = document.getElementById(containerId);
  if (!el || typeof Plotly === 'undefined') return;

  const paletteColors = ['#1D4ED8', '#C2410C', '#15803D', '#7C3AED', '#0F766E'];
  const isSmallScreen = typeof window !== 'undefined' && window.innerWidth < 640;
  const layoutBase = {
    paper_bgcolor: '#FFFFFF',
    plot_bgcolor: '#FAF8F5',
    margin: {
      l: isSmallScreen ? 38 : 52,
      r: isSmallScreen ? 14 : 28,
      t: isSmallScreen ? 32 : 40,
      b: isSmallScreen ? 36 : 46
    },
    font: { family: 'IBM Plex Sans, sans-serif', size: isSmallScreen ? 10 : 11, color: '#18181B' },
  };

  const plotFn = isUpdate ? Plotly.react : Plotly.newPlot;

  if (plotData.type === '2d') {
    const rawTraces = Array.isArray(plotData.traces) && plotData.traces.length > 0
      ? plotData.traces
      : [{ y: plotData.y, name: 'f(x)' }];

    const traces = rawTraces.map((tr, i) => ({
      x: plotData.x,
      y: tr.y,
      mode: 'lines',
      line: {
        color: paletteColors[i % paletteColors.length],
        width: 2.5,
        dash: i === 0 ? 'solid' : (i === 1 ? 'dash' : 'dot')
      },
      name: tr.name || `Curve ${i + 1}`
    }));

    const layout = {
      ...layoutBase,
      title: { text: plotData.title || `2D Curve over [${plotData.x[0]}, ${plotData.x[plotData.x.length - 1]}]`, font: { size: 12 } },
      xaxis: { title: plotData.var || 'x', gridcolor: '#E4E2DD', zerolinecolor: '#A1A1AA' },
      yaxis: { title: 'y', gridcolor: '#E4E2DD', zerolinecolor: '#A1A1AA' },
      showlegend: traces.length > 1,
      legend: { orientation: 'h', y: 1.12, x: 0 }
    };
    plotFn(el, traces, layout, { responsive: true, displaylogo: false });

  } else if (plotData.type === 'parametric') {
    const traces = plotData.traces || [{
      x: plotData.x,
      y: plotData.y,
      mode: 'lines',
      line: { color: '#C2410C', width: 2.5 },
      name: plotData.title || 'Parametric'
    }];
    const isMohr = (plotData.title || '').toLowerCase().includes('mohr');
    const layout = {
      ...layoutBase,
      title: { text: plotData.title || '2D Parametric Curve', font: { size: 12 } },
      xaxis: { title: plotData.xlab || 'x(t)', gridcolor: '#E4E2DD', zerolinecolor: '#A1A1AA' },
      yaxis: {
        title: plotData.ylab || 'y(t)',
        gridcolor: '#E4E2DD',
        zerolinecolor: '#A1A1AA',
        ...(isMohr ? { scaleanchor: 'x', scaleratio: 1 } : {})
      },
      showlegend: traces.length > 1,
      legend: { orientation: 'h', y: 1.15, x: 0 }
    };
    plotFn(el, traces, layout, { responsive: true, displaylogo: false });

  } else if (plotData.type === 'vector_2d') {
    const trace = {
      x: plotData.quiverX,
      y: plotData.quiverY,
      mode: 'lines',
      line: { color: '#1D4ED8', width: 1.75 },
      name: 'Vector Field'
    };
    const layout = {
      ...layoutBase,
      title: { text: plotData.title || '2D Vector Field Quiver Plot', font: { size: 12 } },
      xaxis: { title: 'x', range: [plotData.xmin, plotData.xmax], gridcolor: '#E4E2DD', zerolinecolor: '#A1A1AA' },
      yaxis: { title: 'y', range: [plotData.ymin, plotData.ymax], gridcolor: '#E4E2DD', zerolinecolor: '#A1A1AA', scaleanchor: 'x', scaleratio: 1 }
    };
    plotFn(el, [trace], layout, { responsive: true, displaylogo: false });

  } else if (plotData.type === '3d') {
    const trace = {
      x: plotData.x,
      y: plotData.y,
      z: plotData.z,
      type: 'surface',
      colorscale: 'Viridis',
      showscale: true,
      contours: {
        z: {
          show: true,
          usecolormap: true,
          highlightcolor: '#1D4ED8',
          project: { z: true }
        }
      }
    };
    if (plotData.surfacecolor) {
      trace.surfacecolor = plotData.surfacecolor;
    }
    if (plotData.colorbarTitle) {
      trace.colorbar = { title: plotData.colorbarTitle, titleside: 'right' };
    }
    const layout = {
      ...layoutBase,
      margin: { l: 10, r: 10, t: 36, b: 10 },
      title: { text: plotData.title || '3D Surface & Contours z = f(x, y)', font: { size: 12 } },
      scene: {
        xaxis: { title: 'x' },
        yaxis: { title: 'y' },
        zaxis: { title: plotData.zlab || 'z' }
      }
    };
    plotFn(el, [trace], layout, { responsive: true, displaylogo: false });
  }
}

// ============================================================================
// CELL EVALUATION & PYODIDE EXECUTION
// ============================================================================

async function evaluateCell(cellId) {
  const cell = AppState.cells.find(c => c.id === cellId);
  if (!cell) return;

  // Sync latest input from active mode editor
  const mf = document.getElementById(`mf_${cell.id}`);
  if (mf && cell.mode === 'visual') {
    cell.latex = mf.value;
  }
  if (cell.mode === 'code') {
    if (AppState.codeMirrors[cell.id]) {
      cell.code = AppState.codeMirrors[cell.id].getValue();
    } else {
      const ta = document.getElementById(`cm_${cell.id}`);
      if (ta) cell.code = ta.value;
    }
  }

  if (!AppState.kernelReady) {
    return;
  }
  if (cell.mode === 'code' && !confirmUntrustedCode()) {
    return;
  }

  setActiveCell(cell.id, false);
  setKernelStatus('busy', 'Kernel: Busy (Evaluating Symbolic Expression)...');
  setCellRunning(cell.id, true);

  const t0 = performance.now();
  AppState.evalCounter += 1;
  cell.inIndex = AppState.evalCounter;

  const payload = {
    mode: cell.mode || 'visual',
    latex: cell.latex,
    code: cell.code,
    operation: cell.operation,
    params: cell.params,
    assignTo: cell.assignTo,
    inIndex: cell.inIndex
  };

  try {
    AppState.kernelBusy = true;
    const rawResultJson = await Kernel.call('execute_notebook_cell', [JSON.stringify(payload)], { timeLimit: getTimeLimitSeconds() });
    const response = JSON.parse(rawResultJson);

    const t1 = performance.now();
    cell.execTimeMs = Math.round(t1 - t0);

    if (response.status === 'ok') {
      cell.output = {
        status: 'ok',
        latex: response.latex,
        approxLatex: response.approxLatex,
        showDecimal: false,
        sympyCode: response.sympyCode,
        stdout: response.stdout || '',
        assigned: response.assigned,
        warning: response.warning,
        parsedLatex: cell.mode === 'code' ? null : (response.parsedLatex || null),
        parseWarnings: response.warnings || [],
        plotData: response.plotData || null
      };
      if (response.session) {
        updateVariableInspectorUI(response.session);
      }
    } else {
      cell.output = {
        status: 'error',
        message: response.message || 'Unable to parse or evaluate expression.',
        parseWarnings: response.warnings || [],
        stdout: response.stdout || ''
      };
    }
  } catch (err) {
    if (err.interrupted) AppState.stopRunAll = true;
    cell.execTimeMs = Math.round(performance.now() - t0);
    cell.output = {
      status: 'error',
      interrupted: !!err.interrupted,
      message: err.message || String(err)
    };
  }

  AppState.kernelBusy = false;
  setCellRunning(cell.id, false);
  if (AppState.kernelReady) setKernelStatus('ready', 'Kernel: Ready (SymPy Active)');

  // Update Cell DOM Header & Output
  const card = document.getElementById(`dom_${cell.id}`);
  if (card) {
    if (cell.mode === 'code') refreshCodePreview(cell);
    const inBadge = card.querySelector('.cell-in-badge');
    if (inBadge) inBadge.textContent = `In [${cell.inIndex}]:`;
    const timeBadge = card.querySelector('.cell-time-badge');
    if (timeBadge && cell.execTimeMs !== null) {
      timeBadge.innerHTML = `<span class="text-[11px] font-mono text-emerald bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">${cell.execTimeMs} ms</span>`;
    }
    renderCellOutput(card, cell);
  }

  updateActiveCellIndicator();
  saveNotebookToLocalStorage();
}

/** Imported notebooks may contain Python written by someone else: ask once before running it. */
function confirmUntrustedCode() {
  const tab = getActiveTab();
  if (!tab || !tab.untrusted) return true;
  const n = tab.cells.filter(c => c.mode === 'code' && (c.code || '').trim()).length;
  const ok = window.confirm(
    `"${tab.name}" was imported from a file and contains ${n} Python code cell(s).\n\n` +
    'Python runs in a sandboxed worker in this browser tab, but it can make network requests. ' +
    'Only run code from notebooks you trust.\n\nRun the code cells in this notebook?'
  );
  if (ok) {
    tab.untrusted = false;
    saveNotebookToLocalStorage();
  } else {
    AppState.stopRunAll = true;
  }
  return ok;
}

/** Toggle a cell's Evaluate button into a Stop button while the kernel works on it. */
function setCellRunning(cellId, running) {
  AppState.runningCellId = running ? cellId : (AppState.runningCellId === cellId ? null : AppState.runningCellId);
  const card = document.getElementById(`dom_${cellId}`);
  const btn = card && card.querySelector('.btn-evaluate-cell');
  if (!btn) return;
  const span = btn.querySelector('span');
  const cell = AppState.cells.find(c => c.id === cellId);
  if (running) {
    btn.classList.remove('bg-cobalt', 'hover:bg-blue-800');
    btn.classList.add('bg-red-700', 'hover:bg-red-800');
    btn.title = Kernel.canInterrupt ? 'Stop this computation' : 'Stop this computation (restarts the kernel and clears variables)';
    if (span) span.textContent = 'Stop';
  } else {
    btn.classList.remove('bg-red-700', 'hover:bg-red-800');
    btn.classList.add('bg-cobalt', 'hover:bg-blue-800');
    btn.title = 'Evaluate Cell (Shift + Enter)';
    if (span) span.textContent = cell && cell.mode === 'code' ? 'Run Script' : 'Evaluate';
  }
}

async function evaluateAllCells() {
  if (!AppState.kernelReady) return;
  const startTabId = AppState.activeTabId;
  AppState.stopRunAll = false;
  for (const cell of AppState.cells.slice()) {
    if (AppState.stopRunAll) return;
    if (AppState.activeTabId !== startTabId) {
      // User switched tabs mid-run: mark the old tab for a clean re-run when revisited
      const oldTab = AppState.tabs.find(t => t.id === startTabId);
      if (oldTab) oldTab.evaluated = false;
      return;
    }
    const hasContent = cell.mode === 'code'
      ? (cell.code && cell.code.trim())
      : (cell.latex && cell.latex.trim());
    if (hasContent) {
      await evaluateCell(cell.id);
    }
  }
}

// ============================================================================
// ACTIVE CELL SELECTION, PALETTE INSERTION & OPERATIONS
// ============================================================================

function setActiveCell(cellId, focusEditor = true) {
  AppState.activeCellId = cellId;
  document.querySelectorAll('.notebook-cell').forEach(el => {
    el.classList.toggle('active-cell', el.id === `dom_${cellId}`);
  });
  updateActiveCellIndicator();

  if (focusEditor) {
    const cell = AppState.cells.find(c => c.id === cellId);
    if (cell && cell.mode === 'code') {
      if (AppState.codeMirrors[cellId]) {
        AppState.codeMirrors[cellId].focus();
      } else {
        const ta = document.getElementById(`cm_${cellId}`);
        if (ta) ta.focus();
      }
    } else {
      const mf = document.getElementById(`mf_${cellId}`);
      if (mf) mf.focus();
    }
  }
}

function updateActiveCellIndicator() {
  const indicator = document.getElementById('activeCellIndicator');
  const idx = AppState.cells.findIndex(c => c.id === AppState.activeCellId);
  if (idx === -1) return;
  const cell = AppState.cells[idx];
  const label = cell.inIndex ? `In[${cell.inIndex}]` : `Cell #${idx + 1}`;
  indicator.textContent = `Target: ${label} (${cell.mode === 'code' ? 'Code' : 'Visual'})`;
}

function getActiveCell() {
  return AppState.cells.find(c => c.id === AppState.activeCellId) || AppState.cells[0];
}

function insertLatexIntoActiveMathField(latexSnippet) {
  const cell = getActiveCell();
  if (!cell) return;

  if (cell.mode === 'code') {
    const cm = AppState.codeMirrors[cell.id];
    if (cm) {
      cm.replaceSelection(latexSnippet);
      cm.focus();
      return;
    }
  }

  const mf = document.getElementById(`mf_${cell.id}`);
  if (!mf) return;

  mf.focus();
  if (typeof mf.executeCommand === 'function') {
    mf.executeCommand(['insert', latexSnippet]);
  } else {
    mf.value = (mf.value || '') + latexSnippet;
  }
  cell.latex = mf.value;
  saveNotebookToLocalStorage();
}

function applyOperationToActiveCell(rawOpKey) {
  const opKey = normalizeOperationKey(rawOpKey);
  const cell = getActiveCell();
  if (!cell || !OPERATIONS[opKey]) return;

  const card = document.getElementById(`dom_${cell.id}`);
  if (cell.mode === 'code' && card) {
    switchCellMode(cell, card, 'visual');
  }

  cell.operation = opKey;
  OPERATIONS[opKey].params.forEach(p => {
    if (cell.params[p.key] === undefined) {
      cell.params[p.key] = p.default;
    }
  });

  if (card) {
    const select = card.querySelector('.cell-op-select');
    if (select) select.value = opKey;
    renderCellParams(card, cell);
  }
  saveNotebookToLocalStorage();
}

function insertOdeTemplate(tplKey) {
  const cell = getActiveCell();
  if (!cell) return;
  applyOperationToActiveCell('ode_solve');

  const mf = document.getElementById(`mf_${cell.id}`);
  if (tplKey === 'first_order') {
    cell.latex = "y'(x) + k \\cdot y(x) = 0";
    cell.params = { func: 'y(x)', ic1: 'y(0)=1', ic2: '' };
  } else if (tplKey === 'harmonic') {
    cell.latex = "y''(x) + 2\\zeta\\omega y'(x) + \\omega^2 y(x) = 0";
    cell.params = { func: 'y(x)', ic1: '', ic2: '' };
  } else if (tplKey === 'rlc') {
    cell.latex = "y''(x) + y(x) = \\cos(2x)";
    cell.params = { func: 'y(x)', ic1: 'y(0)=0', ic2: "y'(0)=0" };
  }

  if (mf) mf.value = cell.latex;
  const card = document.getElementById(`dom_${cell.id}`);
  if (card) renderCellParams(card, cell);
  saveNotebookToLocalStorage();
}

function insertMatrixLatexIntoActiveCell(rows, cols, valuesGrid = null) {
  const rowStrings = [];
  for (let r = 0; r < rows; r++) {
    const colStrings = [];
    for (let c = 0; c < cols; c++) {
      if (valuesGrid && valuesGrid[r] && valuesGrid[r][c] !== undefined) {
        colStrings.push(valuesGrid[r][c]);
      } else {
        colStrings.push(r === c ? '1' : '0');
      }
    }
    rowStrings.push(colStrings.join(' & '));
  }
  const matrixLatex = `\\begin{pmatrix} ${rowStrings.join(' \\\\ ')} \\end{pmatrix}`;
  insertLatexIntoActiveMathField(matrixLatex);
}

// ============================================================================
// VISUAL MATRIX BUILDER MODAL
// ============================================================================

function openMatrixModal() {
  const modal = document.getElementById('matrixModal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  renderMatrixModalGrid();
}

function closeMatrixModal() {
  const modal = document.getElementById('matrixModal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function renderMatrixModalGrid() {
  const rows = parseInt(document.getElementById('matrixRowsSelect').value, 10);
  const cols = parseInt(document.getElementById('matrixColsSelect').value, 10);
  const container = document.getElementById('matrixGridContainer');

  container.style.gridTemplateColumns = `repeat(${cols}, minmax(60px, 1fr))`;
  container.innerHTML = '';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.dataset.row = r;
      inp.dataset.col = c;
      inp.value = r === c ? '1' : '0';
      inp.className = 'matrix-cell-input w-full text-center font-mono text-sm py-1.5 px-2 bg-surface border border-borderWarm rounded focus:outline-none focus:border-cobalt';
      container.appendChild(inp);
    }
  }
}

function fillModalIdentityMatrix() {
  document.querySelectorAll('.matrix-cell-input').forEach(inp => {
    const r = parseInt(inp.dataset.row, 10);
    const c = parseInt(inp.dataset.col, 10);
    inp.value = r === c ? '1' : '0';
  });
}

function insertModalMatrixIntoCell() {
  const rows = parseInt(document.getElementById('matrixRowsSelect').value, 10);
  const cols = parseInt(document.getElementById('matrixColsSelect').value, 10);
  const grid = Array.from({ length: rows }, () => Array(cols).fill('0'));

  document.querySelectorAll('.matrix-cell-input').forEach(inp => {
    const r = parseInt(inp.dataset.row, 10);
    const c = parseInt(inp.dataset.col, 10);
    grid[r][c] = inp.value.trim() || '0';
  });

  closeMatrixModal();
  insertMatrixLatexIntoActiveCell(rows, cols, grid);
}

// ============================================================================
// ADD, MOVE, DELETE CELLS & VARIABLE INSPECTOR
// ============================================================================

function addNewCellAfter(index, overrides = {}) {
  const newCell = createCellModel(overrides);
  AppState.cells.splice(index + 1, 0, newCell);
  renderAllCells();
  setActiveCell(newCell.id, true);
  saveNotebookToLocalStorage();
  return newCell;
}

function deleteCell(cellId) {
  if (AppState.cells.length <= 1) {
    AppState.cells[0].latex = '';
    AppState.cells[0].code = '';
    AppState.cells[0].output = null;
    AppState.cells[0].inIndex = null;
    renderAllCells();
    saveNotebookToLocalStorage();
    return;
  }
  const idx = AppState.cells.findIndex(c => c.id === cellId);
  if (idx === -1) return;
  AppState.cells.splice(idx, 1);
  if (AppState.activeCellId === cellId) {
    const nextCell = AppState.cells[Math.max(0, idx - 1)];
    AppState.activeCellId = nextCell ? nextCell.id : null;
  }
  renderAllCells();
  saveNotebookToLocalStorage();
}

function moveCell(index, delta) {
  const target = index + delta;
  if (target < 0 || target >= AppState.cells.length) return;
  const temp = AppState.cells[index];
  AppState.cells[index] = AppState.cells[target];
  AppState.cells[target] = temp;
  renderAllCells();
  saveNotebookToLocalStorage();
}

function updateVariableInspectorUI(sessionData) {
  const varsListEl = document.getElementById('inspectorVarsList');
  const outListEl = document.getElementById('inspectorOutList');
  const varBadge = document.getElementById('varCountBadge');
  const outBadge = document.getElementById('outCountBadge');
  const assumptionsEl = document.getElementById('assumptionsActiveList');
  const mobileDot = document.getElementById('mobileSidebarBadge');

  const vars = sessionData.vars || [];
  const outs = sessionData.outs || [];
  const assumptions = sessionData.assumptions || [];

  if (varBadge) varBadge.textContent = vars.length;
  if (outBadge) outBadge.textContent = outs.length;
  if (mobileDot) mobileDot.classList.toggle('hidden', vars.length === 0 && outs.length === 0);

  if (assumptionsEl) {
    if (assumptions.length > 0) {
      assumptionsEl.innerHTML = assumptions.map(a =>
        `<span class="px-1.5 py-0.5 rounded bg-blue-50 text-cobalt border border-blue-200 font-mono text-[10px]"><strong>${escapeHtml(a.name)}</strong>: ${escapeHtml(a.flags.join(', '))}</span>`
      ).join('');
    } else {
      renderAssumptionsBadgesFromState();
    }
  }

  if (vars.length === 0) {
    varsListEl.innerHTML = `<p class="text-muted italic text-xs py-1.5">No custom symbols or functions assigned yet.</p>`;
  } else {
    varsListEl.innerHTML = '';
    vars.forEach(v => {
      const item = document.createElement('div');
      item.className = 'px-2 py-1.5 rounded bg-paper border border-borderWarm hover:border-cobalt/60 transition cursor-pointer flex items-center justify-between gap-2';
      item.title = `Click to insert ${v.name} into active cell`;
      item.innerHTML = `
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="font-mono font-semibold text-cobalt text-xs shrink-0">${escapeHtml(v.name)} =</span>
          <div class="var-katex-preview overflow-x-auto text-xs py-0.5 min-w-0"></div>
        </div>
        <span class="text-[9px] font-mono px-1 py-0.5 rounded bg-subtle text-muted shrink-0">${escapeHtml(v.type)}</span>
      `;
      const preview = item.querySelector('.var-katex-preview');
      try {
        katex.render(v.latex, preview, { displayMode: false, throwOnError: false });
      } catch (e) {
        preview.textContent = v.latex;
      }
      item.addEventListener('click', () => {
        const cleanName = v.name.split('(')[0];
        insertLatexIntoActiveMathField(cleanName);
      });
      varsListEl.appendChild(item);
    });
  }

  if (outs.length === 0) {
    outListEl.innerHTML = `<p class="text-muted italic text-xs py-1.5">Evaluate a cell to populate <code class="font-mono">%1, %2</code> history.</p>`;
  } else {
    outListEl.innerHTML = '';
    outs.slice().reverse().forEach(o => {
      const item = document.createElement('div');
      item.className = 'px-2 py-1.5 rounded bg-paper border border-borderWarm hover:border-terracotta/60 transition cursor-pointer flex items-center justify-between gap-2';
      item.title = `Click to insert %${o.index} (Out[${o.index}]) into active cell`;
      item.innerHTML = `
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="font-mono font-semibold text-terracotta text-xs shrink-0">%${o.index}:</span>
          <div class="out-katex-preview overflow-x-auto text-xs py-0.5 min-w-0"></div>
        </div>
        <span class="text-[9px] font-mono text-muted shrink-0">Out[${o.index}]</span>
      `;
      const preview = item.querySelector('.out-katex-preview');
      try {
        katex.render(o.latex, preview, { displayMode: false, throwOnError: false });
      } catch (e) {
        preview.textContent = o.latex;
      }
      item.addEventListener('click', () => {
        insertLatexIntoActiveMathField(`%${o.index}`);
      });
      outListEl.appendChild(item);
    });
  }
}

// ============================================================================
// MULTI-NOTEBOOK TABS (several notebooks open at once, isolated kernel memory)
// ============================================================================

function makeTabId() {
  return 'tab_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function getActiveTab() {
  return AppState.tabs.find(t => t.id === AppState.activeTabId) || null;
}

function syncActiveTabFromState() {
  const tab = getActiveTab();
  if (!tab) return;
  tab.cells = AppState.cells;
  tab.evalCounter = AppState.evalCounter;
  tab.symbolAssumptions = AppState.symbolAssumptions || {};
}

function applyTabToState(tab) {
  AppState.activeTabId = tab.id;
  AppState.cells = tab.cells;
  AppState.evalCounter = tab.evalCounter || 0;
  AppState.symbolAssumptions = tab.symbolAssumptions || {};
  AppState.activeCellId = AppState.cells[0]?.id || null;
}

function isTabEmpty(tab) {
  return !tab.cells.length || tab.cells.every(c => !(c.latex || '').trim() && !(c.code || '').trim());
}

function renderTabsBar() {
  const list = document.getElementById('notebookTabsList');
  if (!list) return;
  list.innerHTML = '';
  AppState.tabs.forEach(tab => {
    const isActive = tab.id === AppState.activeTabId;
    const el = document.createElement('div');
    el.className = `notebook-tab group flex items-center gap-1.5 max-w-[220px] pl-2.5 sm:pl-3 pr-1.5 py-1.5 rounded-t-md border text-xs cursor-pointer select-none transition shrink-0 ${
      isActive
        ? 'bg-surface border-borderWarm border-b-surface text-cobalt font-semibold shadow-2xs'
        : 'bg-subtle/60 border-transparent text-muted hover:text-ink hover:bg-subtle'
    }`;
    el.title = `${tab.name}\n(tap edit or double-click to rename)`;
    el.innerHTML = `
      <span class="truncate max-w-[125px] sm:max-w-[160px]">${escapeHtml(tab.name)}</span>
      <button class="btn-rename-tab shrink-0 w-4 h-4 leading-none rounded text-muted hover:text-cobalt opacity-70 hover:opacity-100 ${isActive ? '' : 'hidden sm:inline-block'}" title="Rename notebook tab">
        <svg class="w-3 h-3 inline" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
      </button>
      <button class="btn-close-tab shrink-0 w-4 h-4 leading-none rounded text-muted hover:text-white hover:bg-red-500 ${isActive ? '' : 'opacity-60 hover:opacity-100'}" title="Close tab">&times;</button>
    `;
    const doRename = () => {
      const newName = prompt('Rename notebook tab:', tab.name);
      if (newName && newName.trim()) {
        tab.name = newName.trim().slice(0, 60);
        renderTabsBar();
        saveNotebookToLocalStorage();
      }
    };
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.btn-close-tab') || ev.target.closest('.btn-rename-tab')) return;
      switchTab(tab.id);
    });
    el.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('.btn-close-tab')) return;
      doRename();
    });
    const renameBtn = el.querySelector('.btn-rename-tab');
    if (renameBtn) {
      renameBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        doRename();
      });
    }
    el.querySelector('.btn-close-tab').addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeTab(tab.id);
    });
    list.appendChild(el);
  });
}

async function activateKernelSessionForTab(tab, autoEval = false) {
  if (!AppState.kernelReady || !tab) return;
  const parsed = JSON.parse(await Kernel.call('switch_session', [tab.id]));
  if (!tab.evaluated) {
    tab.evaluated = true;
    await Kernel.call('reset_session_memory');
    AppState.evalCounter = 0;
    updateVariableInspectorUI({ vars: [], outs: [], assumptions: [] });
    await syncSavedAssumptionsToKernel();
    if (autoEval) {
      await evaluateAllCells();
    }
  } else if (parsed.session) {
    updateVariableInspectorUI(parsed.session);
  }
}

async function switchTab(tabId, autoEval = false) {
  if (tabId === AppState.activeTabId) return;
  const target = AppState.tabs.find(t => t.id === tabId);
  if (!target) return;
  syncActiveTabFromState();
  applyTabToState(target);
  switchRibbonTab('tab-calculus');
  renderTabsBar();
  renderAllCells();
  renderAssumptionsBadgesFromState();
  saveNotebookToLocalStorage();
  await activateKernelSessionForTab(target, autoEval);
}

async function openNewTab(name, cells, symbolAssumptions = {}, autoEval = false) {
  const tab = {
    id: makeTabId(),
    name: name || 'Untitled',
    cells: cells && cells.length ? cells : [createCellModel({ mode: 'visual' })],
    symbolAssumptions,
    evalCounter: 0,
    evaluated: false
  };
  AppState.tabs.push(tab);
  await switchTab(tab.id, autoEval);
  return tab;
}

async function closeTab(tabId) {
  const idx = AppState.tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;
  const tab = AppState.tabs[idx];
  if (tab.id === AppState.activeTabId) syncActiveTabFromState();
  if (!isTabEmpty(tab) && !confirm(`Close "${tab.name}"? Its cells will be discarded (export JSON first to keep them).`)) return;

  if (AppState.tabs.length === 1) {
    // Last tab: reset it to an empty note instead of leaving no notebook open
    tab.name = 'Untitled 1';
    tab.cells = PRESET_NOTEBOOKS.blank.map(c => createCellModel({ ...c }));
    tab.symbolAssumptions = {};
    tab.evalCounter = 0;
    tab.evaluated = false;
    applyTabToState(tab);
    renderTabsBar();
    renderAllCells();
    renderAssumptionsBadgesFromState();
    saveNotebookToLocalStorage();
    await activateKernelSessionForTab(tab);
    return;
  }

  AppState.tabs.splice(idx, 1);
  if (tab.id === AppState.activeTabId) {
    const next = AppState.tabs[Math.max(0, idx - 1)];
    AppState.activeTabId = null; // force switchTab to load the neighbour
    applyTabToState(next);
    renderTabsBar();
    renderAllCells();
    renderAssumptionsBadgesFromState();
    await activateKernelSessionForTab(next);
  } else {
    renderTabsBar();
  }
  if (AppState.kernelReady) {
    await Kernel.call('drop_session', [tab.id]);
  }
  saveNotebookToLocalStorage();
}

// ============================================================================
// LOCAL STORAGE PERSISTENCE & JSON IMPORT / EXPORT
// ============================================================================

function serializeCells(cells) {
  return cells.map(c => ({
    id: c.id,
    mode: c.mode || 'visual',
    title: c.title || '',
    latex: c.latex || '',
    code: c.code || '',
    operation: c.operation,
    params: c.params,
    assignTo: c.assignTo
  }));
}

function saveNotebookToLocalStorage() {
  try {
    syncActiveTabFromState();
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({
      version: '3.1',
      savedAt: new Date().toISOString(),
      activeTabId: AppState.activeTabId,
      tabs: AppState.tabs.map(t => ({
        id: t.id,
        name: t.name,
        symbolAssumptions: t.symbolAssumptions || {},
        untrusted: !!t.untrusted,
        cells: serializeCells(t.cells)
      }))
    }));
  } catch (e) {
    console.warn('Could not auto-save notebook to localStorage:', e);
  }
}

function loadNotebookFromStorageOrDefault() {
  let tabs = [];
  let activeId = null;
  try {
    const rawWs = localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (rawWs) {
      const ws = JSON.parse(rawWs);
      if (ws && Array.isArray(ws.tabs)) {
        tabs = ws.tabs
          .filter(t => Array.isArray(t.cells))
          .map(t => ({
            id: t.id || makeTabId(),
            name: t.name || 'Untitled',
            symbolAssumptions: t.symbolAssumptions || {},
            untrusted: !!t.untrusted,
            cells: t.cells.length ? t.cells.map(c => createCellModel(c)) : [createCellModel({ mode: 'visual' })],
            evalCounter: 0,
            evaluated: false
          }));
        activeId = ws.activeTabId;
      }
    } else {
      // Migrate legacy single-notebook storage into the first tab
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.cells) && parsed.cells.length > 0) {
          tabs = [{
            id: makeTabId(),
            name: 'Notebook 1',
            symbolAssumptions: parsed.symbolAssumptions || {},
            cells: parsed.cells.map(c => createCellModel(c)),
            evalCounter: 0,
            evaluated: false
          }];
        }
      }
    }
  } catch (e) {
    console.warn('Failed to restore notebook from localStorage:', e);
    tabs = [];
  }

  if (!tabs.length) {
    tabs = [{
      id: makeTabId(),
      name: 'Calculus Starter',
      symbolAssumptions: {},
      cells: PRESET_NOTEBOOKS.default.map(c => createCellModel({ ...c, id: undefined })),
      evalCounter: 0,
      evaluated: false
    }];
  }

  AppState.tabs = tabs;
  applyTabToState(tabs.find(t => t.id === activeId) || tabs[0]);
  renderTabsBar();
  renderAllCells();
  renderAssumptionsBadgesFromState();
  saveNotebookToLocalStorage();
}

async function loadPresetNotebook(presetKey, autoEval = true, tabName = null) {
  const presetCells = PRESET_NOTEBOOKS[presetKey] || PRESET_NOTEBOOKS.default;
  // Fresh ids so the same template can be open in several tabs at once
  const cells = presetCells.map(c => createCellModel({ ...c, id: undefined }));
  const name = tabName || (presetKey === 'blank' ? 'Untitled' : presetKey);
  const current = getActiveTab();

  if (current && isTabEmpty(current)) {
    // Reuse an empty tab instead of piling up blank ones
    current.name = name;
    current.cells = cells;
    current.evalCounter = 0;
    current.evaluated = false;
    applyTabToState(current);
    renderTabsBar();
    renderAllCells();
    saveNotebookToLocalStorage();
    await activateKernelSessionForTab(current, autoEval);
  } else {
    await openNewTab(name, cells, {}, autoEval);
  }
}

function downloadNotebookJson() {
  const tab = getActiveTab();
  const payload = {
    app: 'SymPyStudio',
    version: '3.1',
    name: tab?.name || 'Notebook',
    exportedAt: new Date().toISOString(),
    symbolAssumptions: AppState.symbolAssumptions || {},
    cells: serializeCells(AppState.cells)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = (tab?.name || 'Notebook').replace(/[^a-zA-Z0-9_-]+/g, '_');
  a.download = `SymPyStudio_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function uploadNotebookJson(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data && Array.isArray(data.cells)) {
        const cells = data.cells.map(c => createCellModel({ ...c, id: undefined }));
        const name = data.name || file.name.replace(/\.json$/i, '');
        // Imported notebooks open in their own tab. Their Python code cells only run after the
        // user confirms once (see confirmUntrustedCode).
        const tab = await openNewTab(name, cells, data.symbolAssumptions || {});
        tab.untrusted = cells.some(c => c.mode === 'code' && (c.code || '').trim());
        saveNotebookToLocalStorage();
      }
    } catch (err) {
      alert('Invalid Notebook JSON file: ' + err.message);
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
