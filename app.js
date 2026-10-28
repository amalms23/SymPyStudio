/**
 * SymPyStudio — Visual CAS Notebook with Persistent Memory
 * Powered by Pyodide (WebAssembly Python + SymPy), MathLive, KaTeX, and Plotly.js
 */

const STORAGE_KEY = 'sympystudio_notebook_v2';            // legacy single-notebook key (migrated on load)
const WORKSPACE_STORAGE_KEY = 'sympystudio_workspace_v3'; // multi-tab workspace

// Global Application State
const AppState = {
  pyodide: null,
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

// Operation Metadata & Parameter Configurations
const OPERATIONS = {
  eval: {
    label: 'Standard Evaluate / Symbolic Simplify',
    category: 'tab-calculus',
    params: []
  },
  diff: {
    label: 'Differentiate (d/dx, ∂/∂x)',
    category: 'tab-calculus',
    params: [
      { key: 'var', label: 'With respect to', type: 'text', default: 'x', width: 'w-14' },
      { key: 'order', label: 'Order (n)', type: 'number', default: '1', width: 'w-14' }
    ]
  },
  integrate_indef: {
    label: 'Indefinite Integral (∫ f dx)',
    category: 'tab-calculus',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-14' }
    ]
  },
  integrate_def: {
    label: 'Definite Integral (∫_a^b f dx)',
    category: 'tab-calculus',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-14' },
      { key: 'lower', label: 'Lower (a)', type: 'text', default: '0', width: 'w-20' },
      { key: 'upper', label: 'Upper (b)', type: 'text', default: 'pi', width: 'w-20' }
    ]
  },
  limit: {
    label: 'Limit (lim x → a)',
    category: 'tab-calculus',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-14' },
      { key: 'point', label: 'Approaches (a)', type: 'text', default: '0', width: 'w-20' },
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
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-14' },
      { key: 'point', label: 'Around (x₀)', type: 'text', default: '0', width: 'w-16' },
      { key: 'order', label: 'Order (n)', type: 'number', default: '6', width: 'w-14' }
    ]
  },
  sum: {
    label: 'Symbolic Summation (Σ)',
    category: 'tab-calculus',
    params: [
      { key: 'var', label: 'Index', type: 'text', default: 'n', width: 'w-14' },
      { key: 'lower', label: 'From', type: 'text', default: '1', width: 'w-16' },
      { key: 'upper', label: 'To', type: 'text', default: 'oo', width: 'w-16' }
    ]
  },
  solve: {
    label: 'Solve Equation for Variable',
    category: 'tab-algebra',
    params: [
      { key: 'var', label: 'Solve for', type: 'text', default: 'x', width: 'w-16' }
    ]
  },
  solve_system: {
    label: 'Simultaneous Equation Solver',
    category: 'tab-algebra',
    params: [
      { key: 'eq2', label: '2nd Equation (LaTeX/Math)', type: 'text', default: 'x - y = 1', width: 'w-44' },
      { key: 'eq3', label: '3rd Equation (optional)', type: 'text', default: '', width: 'w-36' },
      { key: 'vars', label: 'Variables (comma-sep)', type: 'text', default: 'x, y', width: 'w-24' }
    ]
  },
  simplify: {
    label: 'Simplify Expression',
    category: 'tab-algebra',
    params: []
  },
  expand: {
    label: 'Expand Expression',
    category: 'tab-algebra',
    params: []
  },
  factor: {
    label: 'Factor Polynomial / Expression',
    category: 'tab-algebra',
    params: []
  },
  apart: {
    label: 'Partial Fraction Decomposition (apart)',
    category: 'tab-algebra',
    params: [
      { key: 'var', label: 'Variable', type: 'text', default: 'x', width: 'w-14' }
    ]
  },
  trigsimp: {
    label: 'Trigonometric Simplification',
    category: 'tab-algebra',
    params: []
  },
  mat_det: {
    label: 'Matrix Determinant det(A)',
    category: 'tab-linalg',
    params: []
  },
  mat_inv: {
    label: 'Matrix Inverse (A⁻¹)',
    category: 'tab-linalg',
    params: []
  },
  mat_transpose: {
    label: 'Matrix Transpose (Aᵀ)',
    category: 'tab-linalg',
    params: []
  },
  mat_trace: {
    label: 'Matrix Trace tr(A)',
    category: 'tab-linalg',
    params: []
  },
  mat_charpoly: {
    label: 'Characteristic Polynomial p(λ)',
    category: 'tab-linalg',
    params: [
      { key: 'var', label: 'Symbol', type: 'text', default: 'lambda', width: 'w-20' }
    ]
  },
  mat_eigen: {
    label: 'Eigenvalues & Eigenvectors',
    category: 'tab-linalg',
    params: []
  },
  vec_grad: {
    label: 'Gradient (∇φ) in Cartesian (x,y,z)',
    category: 'tab-linalg',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-24' }
    ]
  },
  vec_div: {
    label: 'Divergence (∇·F) of Vector [Fx, Fy, Fz]',
    category: 'tab-linalg',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-24' }
    ]
  },
  vec_curl: {
    label: 'Curl (∇×F) of Vector [Fx, Fy, Fz]',
    category: 'tab-linalg',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-24' }
    ]
  },
  vec_laplacian: {
    label: 'Laplacian (∇²φ)',
    category: 'tab-linalg',
    params: [
      { key: 'coords', label: 'Coords', type: 'text', default: 'x, y, z', width: 'w-24' }
    ]
  },
  ode_solve: {
    label: 'ODE Symbolic Solver (sp.dsolve)',
    category: 'tab-ode',
    params: [
      { key: 'func', label: 'Dep. Function', type: 'text', default: 'y(x)', width: 'w-16' },
      { key: 'ic1', label: 'IC 1 (e.g. y(0)=1)', type: 'text', default: '', width: 'w-28' },
      { key: 'ic2', label: "IC 2 (e.g. y'(0)=0)", type: 'text', default: '', width: 'w-28' }
    ]
  },
  plot_2d: {
    label: '2D Function Curves y = f(x) (Multi-Curve Overlays)',
    category: 'tab-plotter',
    params: [
      { key: 'var', label: 'Var', type: 'text', default: 'x', width: 'w-10' },
      { key: 'xmin', label: 'x_min', type: 'text', default: '-10', width: 'w-14' },
      { key: 'xmax', label: 'x_max', type: 'text', default: '10', width: 'w-14' },
      { key: 'overlay', label: 'Overlay f₂; f₃', type: 'text', default: '', width: 'w-32' },
      { key: 'labels', label: 'Labels', type: 'text', default: '', width: 'w-28' },
      { key: 'points', label: 'Samples', type: 'number', default: '400', width: 'w-14' }
    ]
  },
  plot_parametric: {
    label: '2D Parametric Curve x = f(t), y = g(t)',
    category: 'tab-plotter',
    params: [
      { key: 'yt', label: 'y(t) (if not [x,y])', type: 'text', default: 'sin(t)', width: 'w-32' },
      { key: 'var', label: 'Param', type: 'text', default: 't', width: 'w-12' },
      { key: 'tmin', label: 't_min', type: 'text', default: '0', width: 'w-14' },
      { key: 'tmax', label: 't_max', type: 'text', default: '2*pi', width: 'w-16' },
      { key: 'points', label: 'Samples', type: 'number', default: '400', width: 'w-14' }
    ]
  },
  plot_3d: {
    label: '3D Surface & Contours z = f(x, y)',
    category: 'tab-plotter',
    params: [
      { key: 'xmin', label: 'x_min', type: 'text', default: '-5', width: 'w-14' },
      { key: 'xmax', label: 'x_max', type: 'text', default: '5', width: 'w-14' },
      { key: 'ymin', label: 'y_min', type: 'text', default: '-5', width: 'w-14' },
      { key: 'ymax', label: 'y_max', type: 'text', default: '5', width: 'w-14' }
    ]
  },
  plot_vector_2d: {
    label: '2D Vector Field Quiver [Fx, Fy] or ∇φ',
    category: 'tab-plotter',
    params: [
      { key: 'xmin', label: 'x_min', type: 'text', default: '-4', width: 'w-12' },
      { key: 'xmax', label: 'x_max', type: 'text', default: '4', width: 'w-12' },
      { key: 'ymin', label: 'y_min', type: 'text', default: '-4', width: 'w-12' },
      { key: 'ymax', label: 'y_max', type: 'text', default: '4', width: 'w-12' },
      { key: 'grid', label: 'Grid N', type: 'number', default: '15', width: 'w-14' }
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
      operation: 'vec_grad',
      params: { coords: 'x, y, z' },
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

/**
 * Python Kernel Bootstrap Code executed inside Pyodide on startup.
 * Sets up SymPy, custom LaTeX-to-SymPy sanitizer, persistent session_vars,
 * Out[n] history dictionary, and plotting data generators.
 */
const PYTHON_BOOTSTRAP_CODE = String.raw`
import sympy as sp
from sympy import *
import re
import json
import math
import sys
import io
import ast

try:
    from sympy.parsing.latex import parse_latex
    HAS_PARSE_LATEX = True
except Exception:
    HAS_PARSE_LATEX = False

from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor
)

# Global Persistent Memory
session_vars = {}
session_funcs = {}
session_assumptions = {}
out_history = {}

# Pre-defined standard physics & engineering coordinates
x, y, z, t, r, theta, phi = sp.symbols('x y z t r theta phi')
n, k, m, q, c, g, hbar, omega, zeta, alpha, beta, gamma, delta, epsilon, epsilon_0, lam, mu, rho, sigma, tau, psi, Delta = sp.symbols(
    'n k m q c g hbar omega zeta alpha beta gamma delta epsilon epsilon_0 lambda mu rho sigma tau psi Delta'
)

BASE_LOCALS = {
    'x': x, 'y': y, 'z': z, 't': t, 'r': r, 'theta': theta, 'phi': phi,
    'n': n, 'k': k, 'm': m, 'q': q, 'c': c, 'g': g, 'hbar': hbar,
    'omega': omega, 'zeta': zeta, 'alpha': alpha, 'beta': beta, 'gamma': gamma,
    'delta': delta, 'epsilon': epsilon, 'varepsilon_0': epsilon_0, 'epsilon_0': epsilon_0,
    'lambda': lam, 'lam': lam, 'mu': mu, 'rho': rho, 'sigma': sigma, 'tau': tau,
    'psi': psi, 'Delta': Delta,
    'pi': sp.pi, 'e': sp.E, 'E': sp.E, 'oo': sp.oo, 'infty': sp.oo, 'I': sp.I,
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'cot': sp.cot, 'sec': sp.sec, 'csc': sp.csc,
    'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
    'sinh': sp.sinh, 'cosh': sp.cosh, 'tanh': sp.tanh,
    'exp': sp.exp, 'ln': sp.log, 'log': sp.log, 'sqrt': sp.sqrt, 'Abs': sp.Abs,
    'Matrix': sp.Matrix, 'Function': sp.Function, 'Derivative': sp.Derivative, 'Integral': sp.Integral,
    'summation': sp.summation, 'product': sp.product, 'limit': sp.limit, 'integrate': sp.integrate, 'diff': sp.diff
}

GREEK_MAP = {
    r'\alpha': 'alpha', r'\beta': 'beta', r'\gamma': 'gamma', r'\delta': 'delta',
    r'\epsilon': 'epsilon', r'\varepsilon_0': 'epsilon_0', r'\varepsilon': 'epsilon',
    r'\zeta': 'zeta', r'\theta': 'theta', r'\vartheta': 'theta',
    r'\lambda': 'lambda', r'\mu': 'mu', r'\pi': 'pi', r'\rho': 'rho',
    r'\sigma': 'sigma', r'\tau': 'tau', r'\phi': 'phi', r'\varphi': 'phi',
    r'\psi': 'psi', r'\omega': 'omega', r'\hbar': 'hbar', r'\Delta': 'Delta',
    r'\infty': 'oo'
}

def get_eval_locals():
    loc = dict(BASE_LOCALS)
    loc.update(session_vars)
    for fn_name, fn_info in session_funcs.items():
        loc[fn_name] = fn_info['callable']
    return loc

def reset_session_memory():
    session_vars.clear()
    session_funcs.clear()
    out_history.clear()
    return True

def convert_latex_matrix(s):
    pattern = r'\\begin\{(?:p|b|v|B|V)?matrix\}(.*?)\\end\{(?:p|b|v|B|V)?matrix\}'
    def repl(match):
        body = match.group(1).strip()
        rows = [r.strip() for r in body.split(r'\\') if r.strip()]
        row_strs = []
        for r in rows:
            cols = [latex_to_sympy_str(c.strip()) for c in r.split('&')]
            row_strs.append('[' + ', '.join(cols) + ']')
        return 'Matrix([' + ', '.join(row_strs) + '])'
    while re.search(pattern, s, flags=re.DOTALL):
        s = re.sub(pattern, repl, s, flags=re.DOTALL)
    return s

def _extract_braced(s, pos):
    if pos >= len(s) or s[pos] != '{':
        return None, pos
    depth = 0
    start = pos + 1
    for i in range(pos, len(s)):
        if s[i] == '{':
            depth += 1
        elif s[i] == '}':
            depth -= 1
            if depth == 0:
                return s[start:i], i + 1
    return None, pos

def _replace_fracs(s):
    frac_macro = re.compile(r'\\(?:d|t)?frac\s*\{')
    while True:
        m = frac_macro.search(s)
        if not m:
            break
        num, pos2 = _extract_braced(s, m.end() - 1)
        if num is None:
            break
        while pos2 < len(s) and s[pos2].isspace():
            pos2 += 1
        if pos2 >= len(s) or s[pos2] != '{':
            break
        den, end_pos = _extract_braced(s, pos2)
        if den is None:
            break
        num_replaced = _replace_fracs(num)
        den_replaced = _replace_fracs(den)
        s = s[:m.start()] + f"(({num_replaced})/({den_replaced}))" + s[end_pos:]
    return s

def _replace_sqrts(s):
    # 1. \sqrt[n]{body}
    sqrt_n_macro = re.compile(r'\\sqrt\s*\[([^\[\]]*)\]\s*\{')
    while True:
        m = sqrt_n_macro.search(s)
        if not m:
            break
        deg = m.group(1)
        body, end_pos = _extract_braced(s, m.end() - 1)
        if body is None:
            break
        body_replaced = _replace_sqrts(body)
        s = s[:m.start()] + f"(({body_replaced})**(1/({deg})))" + s[end_pos:]

    # 2. \sqrt{body}
    sqrt_macro = re.compile(r'\\sqrt\s*\{')
    while True:
        m = sqrt_macro.search(s)
        if not m:
            break
        body, end_pos = _extract_braced(s, m.end() - 1)
        if body is None:
            break
        body_replaced = _replace_sqrts(body)
        s = s[:m.start()] + f"sqrt({body_replaced})" + s[end_pos:]
    return s

def replace_frac_and_sqrt(s):
    s = re.sub(r'\\(?:d|t)?frac\{\s*d\s*([a-zA-Z])\s*\}\{', r'\\frac{1}{', s)
    s = _replace_fracs(s)
    s = _replace_sqrts(s)
    return s

def latex_to_sympy_str(latex_str, latest_idx=None):
    if not latex_str:
        return '0'
    s = latex_str.strip()

    # Clean MathLive decorators & formatting commands
    s = s.replace(r'\mleft', '').replace(r'\mright', '').replace(r'\left', '').replace(r'\right', '').replace(r'\middle', '')
    s = s.replace(r'\displaystyle', '').replace(r'\textstyle', '')
    s = s.replace(r'\,', ' ').replace(r'\;', ' ').replace(r'\:', ' ').replace(r'\!', '').replace(r'\quad', ' ').replace(r'\qquad', ' ')
    s = s.replace(r'\ ', ' ').replace('~', ' ')
    s = s.replace(r'\cdot', '*').replace(r'\times', '*').replace(r'\ast', '*').replace(r'\div', '/')
    s = s.replace(r'\exponentialE', 'E').replace(r'\imaginaryI', 'I')
    s = s.replace(r'\differentialD', ' d').replace(r'\mathrm{d}', ' d').replace(r'\text{d}', ' d')
    s = s.replace(r'\longrightarrow', r'\to').replace(r'\rightarrow', r'\to')
    s = re.sub(r'\\placeholder\{([^{}]*)\}', lambda m: m.group(1).strip() or '0', s)

    # Handle %n and % output references
    s = s.replace(r'\%', '%')
    def out_ref_repl(m):
        idx = int(m.group(1))
        return f"(_out_ref({idx}))"
    s = re.sub(r'%(\d+)', out_ref_repl, s)
    if latest_idx is not None:
        s = re.sub(r'%(?!\d)', f"(_out_ref({latest_idx}))", s)

    # Handle matrices first
    s = convert_latex_matrix(s)

    # Protect \varepsilon_0 before normalizing unbraced subscripts
    s = re.sub(r'\\varepsilon_0\b', ' epsilon_0 ', s)
    s = re.sub(r'\\epsilon_0\b', ' epsilon_0 ', s)

    # Normalize unbraced single-token subscripts and superscripts:
    # e.g. \int_0^\pi -> \int_{0}^{\pi}, \sum_{n=1}^\infty -> \sum_{n=1}^{\infty}, x^2 -> x^{2}
    s = re.sub(r'_(\\[a-zA-Z]+|[a-zA-Z0-9])(?![a-zA-Z0-9])', r'_{\1}', s)
    s = re.sub(r'\^(\\[a-zA-Z]+|[a-zA-Z0-9])(?![a-zA-Z0-9])', r'^{\1}', s)

    # Normalize reversed integral bounds: \int^{b}_{a} -> \int_{a}^{b}
    s = re.sub(r'(\\int)\^\{([^{}]+)\}_\{([^{}]+)\}', r'\1_{\3}^{\2}', s)

    # Convert derivative templates BEFORE general \frac replacement:
    # Higher-order or 1st-order ordinary derivative: \frac{d}{dx}(expr) or \frac{d^2}{dx^2}(expr) or \frac{d}{dx} expr
    def _ord_diff_paren(m):
        order = m.group(1)
        var = m.group(2)
        body = m.group(3)
        return f"diff({body}, {var}, {order})" if order else f"diff({body}, {var})"
    def _ord_diff_rest(m):
        order = m.group(1)
        var = m.group(2)
        body = m.group(3)
        return f"diff({body}, {var}, {order})" if order else f"diff({body}, {var})"

    s = re.sub(
        r'\\(?:d|t)?frac\{\s*d(?:\^\{(\d+)\})?\s*\}\{\s*d\s*([a-zA-Z]+)(?:\^\{\d+\})?\s*\}\s*\(([^()]+)\)',
        _ord_diff_paren,
        s
    )
    s = re.sub(
        r'\\(?:d|t)?frac\{\s*d(?:\^\{(\d+)\})?\s*\}\{\s*d\s*([a-zA-Z]+)(?:\^\{\d+\})?\s*\}\s*(.+)',
        _ord_diff_rest,
        s
    )
    s = re.sub(
        r'\\(?:d|t)?frac\{\s*\\partial(?:\^\{(\d+)\})?\s*\}\{\s*\\partial\s*([a-zA-Z]+)(?:\^\{\d+\})?\s*\}\s*\(([^()]+)\)',
        _ord_diff_paren,
        s
    )
    s = re.sub(
        r'\\(?:d|t)?frac\{\s*\\partial(?:\^\{(\d+)\})?\s*\}\{\s*\\partial\s*([a-zA-Z]+)(?:\^\{\d+\})?\s*\}\s*(.+)',
        _ord_diff_rest,
        s
    )

    # Replace fractions and roots (before integrals/sums/limits so nested braces in bounds/integrands are resolved)
    s = replace_frac_and_sqrt(s)

    # Absolute value |expr|
    s = re.sub(r'\|([^|]+)\|', r'Abs(\1)', s)

    # Greek symbols (replace before calculus templates so bounds like ^{\pi} or ^{\infty} become ^{pi} or ^{oo})
    for k_lat, v_sym in GREEK_MAP.items():
        s = re.sub(re.escape(k_lat) + r'(?![a-zA-Z])', ' ' + v_sym + ' ', s)

    # Logarithms & Trig functions (insert leading space so \int\sin or x\sin never fuse into intsin / xsin)
    s = re.sub(r'\\log_\{10\}', ' log10_fn', s)
    FN_MAP = {
        'sinh': 'sinh', 'cosh': 'cosh', 'tanh': 'tanh',
        'arcsin': 'asin', 'arccos': 'acos', 'arctan': 'atan',
        'asin': 'asin', 'acos': 'acos', 'atan': 'atan',
        'sin': 'sin', 'cos': 'cos', 'tan': 'tan',
        'cot': 'cot', 'sec': 'sec', 'csc': 'csc',
        'exp': 'exp', 'ln': 'ln', 'log': 'log'
    }
    for fn_lat, fn_sym in FN_MAP.items():
        s = re.sub(r'\\' + fn_lat + r'(?![a-zA-Z])', ' ' + fn_sym + ' ', s)

    # Inline calculus templates in LaTeX (run before wrapping function args so "xdx" splits cleanly into "x" and "dx"):
    diff_var_pat = r'(?:theta|phi|tau|omega|alpha|beta|gamma|delta|epsilon|zeta|lambda|mu|rho|sigma|psi|[a-zA-Z])'

    # 1. Definite integral: \int_{a}^{b} expr dx (supports \int_0^\pi\sin xdx with no spaces)
    def _def_int_repl(m):
        a_bound = m.group(1).strip()
        b_bound = m.group(2).strip()
        body = m.group(3).strip() or '1'
        var = m.group(4).strip()
        return f"integrate({body}, ({var}, {a_bound}, {b_bound}))"

    s = re.sub(
        rf'\\int_\{{([^{{}}]+)\}}\^\{{([^{{}}]+)\}}\s*(.*?)\s*d\s*({diff_var_pat})\b',
        _def_int_repl,
        s
    )
    # Definite integral without explicit dx (defaults variable to x)
    s = re.sub(
        r'\\int_\{([^{}]+)\}\^\{([^{}]+)\}\s*(.+)',
        lambda m: f"integrate({m.group(3).strip() or '1'}, (x, {m.group(1).strip()}, {m.group(2).strip()}))",
        s
    )

    # 2. Indefinite integral: \int expr dx (supports \int\sin xdx with no spaces)
    def _indef_int_repl(m):
        body = m.group(1).strip() or '1'
        var = m.group(2).strip()
        return f"integrate({body}, {var})"

    s = re.sub(
        rf'\\int(?![a-zA-Z_])\s*(.*?)\s*d\s*({diff_var_pat})\b',
        _indef_int_repl,
        s
    )
    # Indefinite integral without explicit dx (defaults variable to x)
    s = re.sub(
        r'\\int(?![a-zA-Z_])\s*(.+)',
        lambda m: f"integrate({m.group(1).strip() or '1'}, x)",
        s
    )

    # 3. Limit: \lim_{x \to a} expr (including one-sided \lim_{x \to a^+} or \lim_{x \to a^-})
    def _limit_repl(m):
        var = m.group(1).strip()
        pt = m.group(2).strip()
        body = m.group(3).strip()
        dir_match = re.match(r'^(.*?)\^\{\s*([+-])\s*\}$', pt)
        if dir_match:
            return f"limit({body}, {var}, {dir_match.group(1).strip()}, '{dir_match.group(2)}')"
        return f"limit({body}, {var}, {pt})"

    s = re.sub(
        r'\\lim_\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\\to\s*(.+?)\}\s*(.+)',
        _limit_repl,
        s
    )

    # 4. Summation: \sum_{n=a}^{b} expr
    s = re.sub(
        r'\\sum_\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^{}]+)\}\^\{([^{}]+)\}\s*(.+)',
        r'summation(\4, (\1, \2, \3))',
        s
    )

    # 5. Product: \prod_{n=a}^{b} expr
    s = re.sub(
        r'\\prod_\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*([^{}]+)\}\^\{([^{}]+)\}\s*(.+)',
        r'product(\4, (\1, \2, \3))',
        s
    )

    # Handle trig/log powers like sin^{2}(x) or sin^{2}x -> (sin(x))**(2)
    fn_names_pat = r'(?:sinh|cosh|tanh|asin|acos|atan|sin|cos|tan|cot|sec|csc|exp|ln|log)'
    s = re.sub(
        rf'\b({fn_names_pat})\s*\^\{{([^{{}}]+)\}}\s*\(([^()]+)\)',
        r'(\1(\3))**(\2)',
        s
    )
    s = re.sub(
        rf'\b({fn_names_pat})\s*\^\{{([^{{}}]+)\}}\s*([a-zA-Z0-9_]+)',
        r'(\1(\3))**(\2)',
        s
    )

    # Wrap unparenthesized single-token function arguments: e.g. "sin x" -> "sin(x)", "cos theta" -> "cos(theta)"
    s = re.sub(
        rf'\b({fn_names_pat})\s+([a-zA-Z0-9_]+)\b(?!\s*\()',
        r'\1(\2)',
        s
    )
    # Remove any extra space between function name and opening parenthesis: "sin (x)" -> "sin(x)"
    s = re.sub(rf'\b({fn_names_pat})\s+\(', r'\1(', s)

    # Subscripts like K_{mat} -> K_mat
    s = re.sub(r'_\{([a-zA-Z0-9_]+)\}', r'_\1', s)

    # Superscripts ^{...} -> **(...)
    exp_pat = re.compile(r'\^\{([^{}]*)\}')
    while exp_pat.search(s):
        s = exp_pat.sub(r'**(\1)', s)
    s = s.replace('^', '**')

    # Remaining braces to parentheses
    s = s.replace('{', '(').replace('}', ')')

    # Clean stray backslashes
    s = s.replace('\\', '')

    return s.strip()

def _out_ref(idx):
    if idx in out_history:
        return out_history[idx]
    raise ValueError(f"Output reference %{idx} does not exist yet.")

def parse_math_input(latex_str, latest_idx=None):
    cleaned = latex_to_sympy_str(latex_str, latest_idx)
    loc = get_eval_locals()
    loc['_out_ref'] = _out_ref
    loc['log10_fn'] = lambda arg: sp.log(arg, 10)

    # Automatically register subscripted symbols (e.g. v_0, x_1, k_B) so split_symbols keeps them intact
    for sub_sym in re.findall(r'\b[a-zA-Z]+_[a-zA-Z0-9_]+\b', cleaned):
        if sub_sym not in loc:
            loc[sub_sym] = sp.Symbol(sub_sym)

    transformations = standard_transformations + (implicit_multiplication_application, convert_xor)

    # Check if cleaned is a vector/list [a, b, c]
    if cleaned.startswith('[') and cleaned.endswith(']') and not cleaned.startswith('Matrix'):
        inner = cleaned[1:-1]
        parts = [parse_expr(p.strip(), local_dict=loc, transformations=transformations) for p in inner.split(',')]
        return sp.Matrix(parts), cleaned

    # Check if cleaned is an equality: LHS = RHS (not ==)
    if '=' in cleaned and not ('==' in cleaned):
        l_s, r_s = cleaned.split('=', 1)
        l_e = parse_expr(l_s.strip(), local_dict=loc, transformations=transformations)
        r_e = parse_expr(r_s.strip(), local_dict=loc, transformations=transformations)
        return sp.Eq(l_e, r_e), cleaned

    try:
        expr = parse_expr(cleaned, local_dict=loc, transformations=transformations)
        return expr, cleaned
    except Exception as first_err:
        if HAS_PARSE_LATEX:
            try:
                expr = parse_latex(latex_str)
                expr = expr.subs(session_vars)
                return expr, f"parse_latex({repr(latex_str)})"
            except Exception:
                pass
        raise first_err

def apply_symbol_assumptions(payload_json):
    data = json.loads(payload_json)
    raw_syms = data.get('symbols', '')
    pos = bool(data.get('positive', False))
    rl  = bool(data.get('real', False))
    itg = bool(data.get('integer', False))
    nz  = bool(data.get('nonzero', False))

    kw = {}
    if pos: kw['positive'] = True
    if rl:  kw['real'] = True
    if itg: kw['integer'] = True
    if nz:  kw['nonzero'] = True

    names = [s.strip() for s in re.split(r'[,\s]+', raw_syms) if s.strip() and re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', s.strip())]
    for nm in names:
        sym_obj = sp.Symbol(nm, **kw)
        BASE_LOCALS[nm] = sym_obj
        session_vars[nm] = sym_obj
        flags = []
        if pos: flags.append('positive')
        if rl:  flags.append('real')
        if itg: flags.append('integer')
        if nz:  flags.append('nonzero')
        session_assumptions[nm] = flags or ['complex']

    return json.dumps({
        'status': 'ok',
        'session': serialize_session()
    })

def serialize_session():
    vars_list = []
    for k_name, val in session_vars.items():
        if isinstance(val, sp.Symbol) and str(val) == k_name and k_name in session_assumptions:
            # Shown in assumptions badges, only list in Assigned Symbols if assigned a value/expression
            continue
        vars_list.append({
            'name': k_name,
            'type': 'Matrix' if isinstance(val, sp.MatrixBase) else 'Symbol/Expr',
            'latex': sp.latex(val)
        })
    for f_name, f_info in session_funcs.items():
        vars_list.append({
            'name': f"{f_name}({', '.join(str(a) for a in f_info['args'])})",
            'type': 'Function',
            'latex': sp.latex(f_info['expr'])
        })
    outs_list = []
    for idx in sorted(out_history.keys()):
        val = out_history[idx]
        if val is not None:
            outs_list.append({
                'index': idx,
                'latex': sp.latex(val)
            })
    assumptions_list = [
        {'name': k, 'flags': v}
        for k, v in sorted(session_assumptions.items())
    ]
    return {'vars': vars_list, 'outs': outs_list, 'assumptions': assumptions_list}
`;

// Python Execution Dispatcher Function registered in Pyodide
const PYTHON_EVAL_RUNNER = String.raw`
def _detect_and_bind_free_params(expr_list, bound_syms, param_overrides=None):
    param_overrides = param_overrides or {}
    bound_names = {str(s) for s in bound_syms}
    free_syms = set()
    for ex in expr_list:
        if hasattr(ex, 'free_symbols'):
            for fs in ex.free_symbols:
                if str(fs) not in bound_names:
                    free_syms.add(fs)
    sorted_syms = sorted(free_syms, key=lambda s: str(s))
    subs_map = {}
    slider_meta = []
    default_presets = {
        'omega_1': 1.0, 'omega_2': 1.732, 'omega': 2.0, 'zeta': 0.2,
        'a': 1.0, 'b': 1.0, 'q_0': 2.0, 'k': 1.5, 'm': 1.0, 'c': 1.0,
        'R': 1.5, 'I': 1.0, 'q': 1.0
    }
    for idx, sym in enumerate(sorted_syms):
        s_name = str(sym)
        default_val = default_presets.get(s_name, 1.0 + 0.5 * (idx % 3))
        if s_name in param_overrides:
            try:
                val = float(param_overrides[s_name])
            except Exception:
                val = default_val
        else:
            val = default_val
        subs_map[sym] = val
        slider_meta.append({
            'name': s_name,
            'latex': sp.latex(sym),
            'min': -5.0 if val < 0 else 0.1,
            'max': max(5.0, round(abs(val) * 3.0, 2)),
            'step': 0.05,
            'value': round(val, 4)
        })
    bound_exprs = [ex.subs(subs_map) if hasattr(ex, 'subs') else ex for ex in expr_list]
    return bound_exprs, slider_meta

def _build_plot_payload(op, expr, raw_latex, params, loc, latest_idx, param_overrides=None):
    transformations = standard_transformations + (implicit_multiplication_application, convert_xor)

    if op == 'plot_2d':
        v_name = params.get('var', 'x').strip() or 'x'
        v_sym = loc.get(v_name, sp.Symbol(v_name))
        if not isinstance(v_sym, sp.Symbol):
            v_sym = sp.Symbol(v_name)
        xmin = float(sp.N(parse_expr(str(params.get('xmin', '-10')), local_dict=loc)))
        xmax = float(sp.N(parse_expr(str(params.get('xmax', '10')), local_dict=loc)))
        n_pts = max(50, min(1500, int(params.get('points', 400) or 400)))

        # Support multi-curve overlays from params['overlay'] or semicolon-separated input
        curve_exprs = [expr.rhs if isinstance(expr, sp.Equality) else expr]
        overlay_raw = str(params.get('overlay', '')).strip()
        if overlay_raw:
            for part in re.split(r'[;,]', overlay_raw):
                if part.strip():
                    ov_e, _ = parse_math_input(part.strip(), latest_idx)
                    if isinstance(ov_e, sp.Equality):
                        ov_e = ov_e.rhs
                    curve_exprs.append(ov_e)

        bound_curves, slider_meta = _detect_and_bind_free_params(curve_exprs, [v_sym], param_overrides)
        labels_raw = [l.strip() for l in str(params.get('labels', '')).split(',') if l.strip()]

        step = (xmax - xmin) / (n_pts - 1)
        xs = [xmin + i * step for i in range(n_pts)]
        traces_out = []
        for idx_c, c_ex in enumerate(bound_curves):
            fn_num = sp.lambdify(v_sym, c_ex, modules=['math'])
            ys = []
            for xv in xs:
                try:
                    yv = fn_num(xv)
                    if isinstance(yv, complex) or math.isnan(yv) or math.isinf(yv):
                        ys.append(None)
                    else:
                        ys.append(float(yv))
                except Exception:
                    ys.append(None)
            lbl = labels_raw[idx_c] if idx_c < len(labels_raw) else f"f{idx_c+1}({v_name}) = {sp.latex(curve_exprs[idx_c])}"
            traces_out.append({'y': ys, 'name': lbl})

        sympy_code_shown = f"f_num = sp.lambdify({v_sym}, {repr(curve_exprs[0])}, 'math')  # Domain [{xmin}, {xmax}]"
        return {
            'type': '2d',
            'x': xs,
            'y': traces_out[0]['y'],
            'traces': traces_out,
            'var': v_name,
            'title': f"y({v_name}) = {sp.latex(curve_exprs[0])}",
            'sliderParams': slider_meta
        }, sympy_code_shown

    elif op == 'plot_parametric':
        v_name = params.get('var', 't').strip() or 't'
        v_sym = loc.get(v_name, sp.Symbol(v_name))
        if not isinstance(v_sym, sp.Symbol):
            v_sym = sp.Symbol(v_name)
        tmin = float(sp.N(parse_expr(str(params.get('tmin', '0')), local_dict=loc)))
        tmax = float(sp.N(parse_expr(str(params.get('tmax', '2*pi')), local_dict=loc)))
        n_pts = max(50, min(1500, int(params.get('points', 400) or 400)))

        if isinstance(expr, sp.MatrixBase) and len(expr) >= 2:
            xt_expr, yt_expr = expr[0], expr[1]
        else:
            xt_expr = expr.rhs if isinstance(expr, sp.Equality) else expr
            yt_raw = str(params.get('yt', 'sin(t)')).strip() or 'sin(t)'
            yt_expr, _ = parse_math_input(yt_raw, latest_idx)
            if isinstance(yt_expr, sp.Equality):
                yt_expr = yt_expr.rhs

        bound_xy, slider_meta = _detect_and_bind_free_params([xt_expr, yt_expr], [v_sym], param_overrides)
        fn_x = sp.lambdify(v_sym, bound_xy[0], modules=['math'])
        fn_y = sp.lambdify(v_sym, bound_xy[1], modules=['math'])

        step = (tmax - tmin) / (n_pts - 1)
        ts = [tmin + i * step for i in range(n_pts)]
        xs, ys = [], []
        for tv in ts:
            try:
                xv = fn_x(tv)
                yv = fn_y(tv)
                if isinstance(xv, complex) or isinstance(yv, complex) or math.isnan(xv) or math.isnan(yv):
                    xs.append(None)
                    ys.append(None)
                else:
                    xs.append(float(xv))
                    ys.append(float(yv))
            except Exception:
                xs.append(None)
                ys.append(None)

        sympy_code_shown = f"fx, fy = sp.lambdify({v_sym}, {repr(xt_expr)}, 'math'), sp.lambdify({v_sym}, {repr(yt_expr)}, 'math')"
        return {
            'type': 'parametric',
            'x': xs,
            'y': ys,
            'var': v_name,
            'xlab': f"x({v_name})",
            'ylab': f"y({v_name})",
            'title': f"Parametric Curve: x({v_name}) = {sp.latex(xt_expr)}, y({v_name}) = {sp.latex(yt_expr)}",
            'sliderParams': slider_meta
        }, sympy_code_shown

    elif op == 'plot_vector_2d':
        xmin = float(sp.N(parse_expr(str(params.get('xmin', '-4')), local_dict=loc)))
        xmax = float(sp.N(parse_expr(str(params.get('xmax', '4')), local_dict=loc)))
        ymin = float(sp.N(parse_expr(str(params.get('ymin', '-4')), local_dict=loc)))
        ymax = float(sp.N(parse_expr(str(params.get('ymax', '4')), local_dict=loc)))
        grid_n = max(6, min(30, int(params.get('grid', 15) or 15)))

        x_sym = loc.get('x', sp.Symbol('x'))
        y_sym = loc.get('y', sp.Symbol('y'))
        if isinstance(expr, sp.MatrixBase) and len(expr) >= 2:
            fx_expr, fy_expr = expr[0], expr[1]
            vec_label = f"F(x,y) = [{sp.latex(fx_expr)}, {sp.latex(fy_expr)}]"
        else:
            # Scalar potential phi(x,y) -> auto-compute gradient nabla(phi)
            fx_expr = sp.diff(expr, x_sym)
            fy_expr = sp.diff(expr, y_sym)
            vec_label = f"∇φ(x,y) = [{sp.latex(fx_expr)}, {sp.latex(fy_expr)}]"

        bound_fxy, slider_meta = _detect_and_bind_free_params([fx_expr, fy_expr], [x_sym, y_sym], param_overrides)
        fn_fx = sp.lambdify((x_sym, y_sym), bound_fxy[0], modules=['math'])
        fn_fy = sp.lambdify((x_sym, y_sym), bound_fxy[1], modules=['math'])

        xs = [xmin + i * (xmax - xmin) / (grid_n - 1) for i in range(grid_n)]
        ys = [ymin + j * (ymax - ymin) / (grid_n - 1) for j in range(grid_n)]
        cell_scale = 0.38 * min((xmax - xmin) / max(1, grid_n - 1), (ymax - ymin) / max(1, grid_n - 1))

        pts_raw = []
        max_mag = 1e-9
        for yv in ys:
            for xv in xs:
                try:
                    u = float(fn_fx(xv, yv))
                    v = float(fn_fy(xv, yv))
                    if math.isnan(u) or math.isnan(v) or math.isinf(u) or math.isinf(v):
                        continue
                    mag = math.hypot(u, v)
                    if mag > max_mag:
                        max_mag = mag
                    pts_raw.append((xv, yv, u, v, mag))
                except Exception:
                    pass

        quiver_x = []
        quiver_y = []
        for (xv, yv, u, v, mag) in pts_raw:
            if mag < 1e-12:
                continue
            # Log-damped scaling so both strong and weak regions are clearly visible
            norm_scale = cell_scale * (0.35 + 0.65 * (mag / max_mag)**0.5) / mag
            dx = u * norm_scale
            dy = v * norm_scale
            x1 = xv + dx
            y1 = yv + dy
            # Arrowhead barbs
            ang = math.atan2(dy, dx)
            head_len = 0.28 * math.hypot(dx, dy)
            hx1 = x1 - head_len * math.cos(ang - 0.45)
            hy1 = y1 - head_len * math.sin(ang - 0.45)
            hx2 = x1 - head_len * math.cos(ang + 0.45)
            hy2 = y1 - head_len * math.sin(ang + 0.45)
            quiver_x.extend([xv, x1, None, hx1, x1, hx2, None])
            quiver_y.extend([yv, y1, None, hy1, y1, hy2, None])

        sympy_code_shown = f"Fx, Fy = sp.lambdify((x, y), {repr(fx_expr)}, 'math'), sp.lambdify((x, y), {repr(fy_expr)}, 'math')"
        return {
            'type': 'vector_2d',
            'quiverX': quiver_x,
            'quiverY': quiver_y,
            'xmin': xmin, 'xmax': xmax, 'ymin': ymin, 'ymax': ymax,
            'title': f"2D Vector Field Quiver: {vec_label}",
            'sliderParams': slider_meta
        }, sympy_code_shown

    else:
        # plot_3d
        xmin = float(sp.N(parse_expr(str(params.get('xmin', '-5')), local_dict=loc)))
        xmax = float(sp.N(parse_expr(str(params.get('xmax', '5')), local_dict=loc)))
        ymin = float(sp.N(parse_expr(str(params.get('ymin', '-5')), local_dict=loc)))
        ymax = float(sp.N(parse_expr(str(params.get('ymax', '5')), local_dict=loc)))
        grid_n = 45

        x_sym = loc.get('x', sp.Symbol('x'))
        y_sym = loc.get('y', sp.Symbol('y'))
        z_expr = expr.rhs if isinstance(expr, sp.Equality) else expr
        bound_z, slider_meta = _detect_and_bind_free_params([z_expr], [x_sym, y_sym], param_overrides)

        fn_3d = sp.lambdify((x_sym, y_sym), bound_z[0], modules=['math'])
        xs = [xmin + i * (xmax - xmin) / (grid_n - 1) for i in range(grid_n)]
        ys = [ymin + j * (ymax - ymin) / (grid_n - 1) for j in range(grid_n)]
        zs = []
        for yv in ys:
            row = []
            for xv in xs:
                try:
                    zv = fn_3d(xv, yv)
                    if isinstance(zv, complex) or math.isnan(zv) or math.isinf(zv):
                        row.append(None)
                    else:
                        row.append(float(zv))
                except Exception:
                    row.append(None)
            zs.append(row)

        sympy_code_shown = f"f_3d = sp.lambdify((x, y), {repr(z_expr)}, 'math')  # Grid {grid_n}x{grid_n}"
        return {
            'type': '3d',
            'x': xs,
            'y': ys,
            'z': zs,
            'title': f"z(x,y) = {sp.latex(z_expr)}",
            'sliderParams': slider_meta
        }, sympy_code_shown

def recompute_plot_with_params(payload_json):
    data = json.loads(payload_json)
    raw_latex = data.get('latex', '').strip()
    op = data.get('operation', 'plot_2d')
    params = data.get('params', {})
    param_values = data.get('paramValues', {})
    latest_idx = max(out_history.keys()) if out_history else None
    try:
        loc = get_eval_locals()
        loc['_out_ref'] = _out_ref
        expr, _ = parse_math_input(raw_latex, latest_idx)
        plot_data, _ = _build_plot_payload(op, expr, raw_latex, params, loc, latest_idx, param_values)
        return json.dumps({'status': 'ok', 'plotData': plot_data})
    except Exception as exc:
        return json.dumps({'status': 'error', 'message': str(exc)})

_CODE_TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)

def _expr_to_pycode(expr_str, loc, decl_syms, decl_funcs):
    """Turn a (possibly implicit-multiplication) math string into valid Python/SymPy source.
    Records free symbols / undefined functions that must be declared in the generated script."""
    expr_str = (expr_str or '').strip()
    if not expr_str:
        return '0'
    # Keep calculus operations unevaluated so the generated script shows the operation itself
    loc = dict(loc)
    loc.update({'integrate': sp.Integral, 'diff': sp.Derivative, 'limit': sp.Limit,
                'summation': sp.Sum, 'product': sp.Product})
    try:
        parsed = parse_expr(expr_str, local_dict=dict(loc), transformations=_CODE_TRANSFORMS, evaluate=False)
    except Exception:
        try:
            parsed = parse_expr(expr_str, local_dict=dict(loc), transformations=_CODE_TRANSFORMS)
        except Exception:
            return expr_str
    try:
        basic = sp.sympify(parsed)
        for s_obj in basic.free_symbols:
            nm = str(s_obj)
            if nm not in loc or loc.get(nm) is not s_obj:
                decl_syms.add(nm)
        for f_obj in basic.atoms(sp.core.function.AppliedUndef):
            fnm = str(f_obj.func)
            if fnm not in loc:
                decl_funcs.add(fnm)
    except Exception:
        pass
    code_out = str(parsed)
    for uneval_nm, call_nm in (('Integral(', 'sp.integrate('), ('Derivative(', 'sp.diff('), ('Limit(', 'sp.limit('),
                               ('Sum(', 'sp.summation('), ('Product(', 'sp.product(')):
        code_out = re.sub(r'(?<![A-Za-z_.])' + re.escape(uneval_nm), call_nm, code_out)
    return code_out

def convert_visual_to_sympy_code(payload_json):
    data = json.loads(payload_json)
    raw_latex = data.get('latex', '').strip()
    op = data.get('operation', 'eval')
    params = data.get('params', {})
    assign_to = data.get('assignTo', '').strip()
    latest_idx = max(out_history.keys()) if out_history else None

    cleaned = latex_to_sympy_str(raw_latex, latest_idx) if raw_latex else '0'
    loc = get_eval_locals()
    loc['_out_ref'] = _out_ref
    decl_syms, decl_funcs = set(), set()

    def pc(s, extra_loc=None):
        use_loc = dict(loc)
        if extra_loc:
            use_loc.update(extra_loc)
        return _expr_to_pycode(s, use_loc, decl_syms, decl_funcs)

    def p_latex(v):
        return pc(latex_to_sympy_str(str(v), latest_idx))

    body = []
    lhs = assign_to if assign_to else "result"
    func_def = re.match(r'^([a-zA-Z][a-zA-Z0-9_]*)\s*\(([a-zA-Z0-9_,\s]+)\)\s*=(?!=)\s*(.+)$', cleaned)
    var_def = re.match(r'^([a-zA-Z][a-zA-Z0-9_]*)\s*=(?!=)\s*(.+)$', cleaned)

    if op == 'eval' and func_def:
        fn_name = func_def.group(1)
        arg_names = [a.strip() for a in func_def.group(2).split(',') if a.strip()]
        extra = {a: loc[a] if isinstance(loc.get(a), sp.Symbol) else sp.Symbol(a) for a in arg_names}
        for a in arg_names:
            if not isinstance(loc.get(a), sp.Symbol):
                decl_syms.add(a)
        rhs_code = pc(func_def.group(3), extra)
        arg_tuple = '(' + ', '.join(arg_names) + (',)' if len(arg_names) == 1 else ')')
        body.append(fn_name + " = sp.Lambda(" + arg_tuple + ", " + rhs_code + ")")
        body.append("result = " + fn_name + "(" + ', '.join(arg_names) + ")")
    elif var_def:
        v_nm = var_def.group(1).strip()
        rhs_c = var_def.group(2).strip()
        if op == 'eval':
            body.append(v_nm + " = " + pc(rhs_c))
        elif op == 'diff':
            v = params.get('var', 'x').strip() or 'x'
            n_ord = str(params.get('order', '1')).strip() or '1'
            body.append(v_nm + " = sp.diff(" + pc(rhs_c) + ", " + pc(v) + ", " + n_ord + ")")
        elif op == 'integrate_indef':
            v = params.get('var', 'x').strip() or 'x'
            body.append(v_nm + " = sp.integrate(" + pc(rhs_c) + ", " + pc(v) + ")")
        elif op == 'integrate_def':
            v = params.get('var', 'x').strip() or 'x'
            body.append(v_nm + " = sp.integrate(" + pc(rhs_c) + ", (" + pc(v) + ", " + p_latex(params.get('lower', '0')) + ", " + p_latex(params.get('upper', 'pi')) + "))")
        elif op in ('simplify', 'expand', 'factor', 'trigsimp'):
            body.append(v_nm + " = sp." + op + "(" + pc(rhs_c) + ")")
        elif op == 'apart':
            v = params.get('var', 'x').strip() or 'x'
            body.append(v_nm + " = sp.apart(" + pc(rhs_c) + ", " + pc(v) + ")")
        elif op == 'solve':
            v = params.get('var', 'x').strip() or 'x'
            body.append("eq = sp.Eq(sp.Symbol('" + v_nm + "'), " + pc(rhs_c) + ")")
            body.append(lhs + " = sp.solve(eq, " + pc(v) + ")")
        else:
            body.append(v_nm + " = " + pc(rhs_c))
        if not any(ln.startswith('result =') for ln in body):
            body.append("result = " + v_nm)
    elif op == 'eval':
        body.append(lhs + " = " + pc(cleaned))
    elif op == 'diff':
        v = params.get('var', 'x').strip() or 'x'
        n_ord = str(params.get('order', '1')).strip() or '1'
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = sp.diff(expr, " + pc(v) + ", " + n_ord + ")")
    elif op == 'integrate_indef':
        v = params.get('var', 'x').strip() or 'x'
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = sp.integrate(expr, " + pc(v) + ")")
    elif op == 'integrate_def':
        v = params.get('var', 'x').strip() or 'x'
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = sp.integrate(expr, (" + pc(v) + ", " + p_latex(params.get('lower', '0')) + ", " + p_latex(params.get('upper', 'pi')) + "))")
    elif op == 'limit':
        v = params.get('var', 'x').strip() or 'x'
        d = params.get('dir', '+-')
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = sp.limit(expr, " + pc(v) + ", " + p_latex(params.get('point', '0')) + ", dir='" + d + "')")
    elif op == 'series':
        v = params.get('var', 'x').strip() or 'x'
        n_ord = str(params.get('order', '6')).strip() or '6'
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = sp.series(expr, " + pc(v) + ", " + p_latex(params.get('point', '0')) + ", " + n_ord + ")")
    elif op == 'sum':
        v = params.get('var', 'n').strip() or 'n'
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = sp.summation(expr, (" + pc(v) + ", " + p_latex(params.get('lower', '1')) + ", " + p_latex(params.get('upper', 'oo')) + "))")
    elif op == 'solve':
        v = params.get('var', 'x').strip() or 'x'
        if '=' in cleaned and '==' not in cleaned:
            l_s, r_s = cleaned.split('=', 1)
            body.append("eq = sp.Eq(" + pc(l_s) + ", " + pc(r_s) + ")")
        else:
            body.append("eq = " + pc(cleaned))
        body.append(lhs + " = sp.solve(eq, " + pc(v) + ")")
    elif op in ('simplify', 'expand', 'factor', 'trigsimp'):
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = sp." + op + "(expr)")
    elif op == 'apart':
        v = params.get('var', 'x').strip() or 'x'
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = sp.apart(expr, " + pc(v) + ")")
    else:
        body.append("expr = " + pc(cleaned))
        body.append(lhs + " = expr")

    if lhs != 'result' and not any(ln.startswith('result =') for ln in body):
        body.append("result = " + lhs)

    lines = ["# Converted from Visual Math Mode"]
    if decl_syms:
        names_sorted = sorted(decl_syms)
        if len(names_sorted) == 1:
            lines.append(names_sorted[0] + " = sp.Symbol('" + names_sorted[0] + "')")
        else:
            lines.append(', '.join(names_sorted) + " = sp.symbols('" + ' '.join(names_sorted) + "')")
    for fnm in sorted(decl_funcs):
        lines.append(fnm + " = sp.Function('" + fnm + "')")
    lines.extend(body)
    return json.dumps({'status': 'ok', 'code': '\n'.join(lines)})


# ---------------------------------------------------------------------------
# Forgiving code-cell preprocessing (math-style f(x) = ... and implicit products)
# ---------------------------------------------------------------------------
_FUNC_DEF_LINE = re.compile(r'^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\)\s*=(?!=)\s*(.+)$')
_SIMPLE_ASSIGN_LINE = re.compile(r'^(\s*)([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*=(?!=)\s*(.+)$')

def _make_lambda(names, body_fn, ns):
    syms = []
    for a_nm in names:
        cur = ns.get(a_nm)
        syms.append(cur if isinstance(cur, sp.Symbol) else sp.Symbol(a_nm))
    return sp.Lambda(tuple(syms), sp.sympify(body_fn(*syms)))

def _pe(src, ns):
    loc = {k: v for k, v in ns.items() if not k.startswith('__')}
    return parse_expr(src, local_dict=loc, transformations=_CODE_TRANSFORMS)

def _line_parses(src):
    try:
        ast.parse(src.strip() or 'pass')
        return True
    except SyntaxError:
        return False

def _bracket_delta(src):
    depth = 0
    quote = None
    i = 0
    while i < len(src):
        ch = src[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in ('"', "'"):
            quote = ch
        elif ch == '#':
            break
        elif ch in '([{':
            depth += 1
        elif ch in ')]}':
            depth -= 1
        i += 1
    return depth

def _preprocess_user_code(code_str):
    # Valid Python is never touched; only rescue code that fails to parse
    try:
        ast.parse(code_str)
        return code_str
    except SyntaxError:
        pass
    out_lines = []
    depth = 0
    for line in code_str.split('\n'):
        stripped = line.strip()
        at_top = depth <= 0
        depth += _bracket_delta(line)
        if not at_top or not stripped or stripped.startswith('#'):
            out_lines.append(line)
            continue
        fm = _FUNC_DEF_LINE.match(line)
        if fm and not _line_parses(line):
            ind, nm, args, rhs = fm.groups()
            arg_list = [a.strip() for a in args.split(',')]
            rhs_src = rhs if _line_parses(rhs) else "_pe(" + repr(rhs) + ", dict(globals(), **{" + ', '.join(repr(a) + ': ' + a for a in arg_list) + "}))"
            out_lines.append(ind + nm + " = _make_lambda(" + repr(arg_list) + ", lambda " + ', '.join(arg_list) + ": " + rhs_src + ", globals())")
            continue
        am = _SIMPLE_ASSIGN_LINE.match(line)
        if am and not _line_parses(line):
            ind, tgt, rhs = am.groups()
            if not _line_parses(rhs):
                out_lines.append(ind + tgt + " = _pe(" + repr(rhs) + ", globals())")
                continue
        out_lines.append(line)
    return '\n'.join(out_lines)

# ---------------------------------------------------------------------------
# Live "Visual Math" preview of a code cell (unevaluated, side-effect free)
# ---------------------------------------------------------------------------
_PREVIEW_UNEVAL = {'integrate': 'Integral', 'diff': 'Derivative', 'limit': 'Limit', 'summation': 'Sum', 'product': 'Product'}
_PREVIEW_HEAVY = {
    'solve', 'dsolve', 'simplify', 'expand', 'factor', 'trigsimp', 'apart', 'series', 'nsolve', 'solveset',
    'linsolve', 'nonlinsolve', 'eigenvals', 'eigenvects', 'lambdify', 'plot', 'fourier_series',
    'laplace_transform', 'inverse_laplace_transform', 'nsimplify', 'together', 'cancel', 'collect',
    'powsimp', 'ratsimp', 'det', 'inv', 'doit', 'charpoly', 'roots', 'expand_trig', 'pde_solve', 'pdsolve',
    'diagonalize', 'rref', 'nullspace', 'integrate', 'diff', 'limit', 'summation', 'product', 'radsimp'
}

def _pv_call(name, *args, **kwargs):
    conv = []
    for a_v in args:
        if isinstance(a_v, (list, tuple)):
            conv.append(sp.Tuple(*[sp.sympify(i) for i in a_v]))
        else:
            conv.append(sp.sympify(a_v))
    return sp.Function(name)(*conv)

class _PreviewTransformer(ast.NodeTransformer):
    def visit_Call(self, node):
        self.generic_visit(node)
        fn = node.func
        fname = None
        is_method = False
        if isinstance(fn, ast.Name):
            fname = fn.id
        elif isinstance(fn, ast.Attribute):
            fname = fn.attr
            is_method = not (isinstance(fn.value, ast.Name) and fn.value.id in ('sp', 'sympy'))
        if not fname:
            return node
        if fname in _PREVIEW_UNEVAL and not is_method:
            node.func = ast.Attribute(value=ast.Name(id='sp', ctx=ast.Load()), attr=_PREVIEW_UNEVAL[fname], ctx=ast.Load())
            return node
        if fname in _PREVIEW_HEAVY:
            new_args = [ast.Constant(value=fname)]
            if is_method:
                new_args.append(fn.value)
            new_args.extend(node.args)
            return ast.Call(func=ast.Name(id='_pv_call', ctx=ast.Load()), args=new_args, keywords=[])
        return node

def _is_symbol_decl(val, names):
    if isinstance(val, sp.Symbol):
        return True
    if isinstance(val, (list, tuple)) and val and all(isinstance(v, (sp.Symbol, sp.core.function.UndefinedFunction)) for v in val):
        return True
    if isinstance(val, sp.core.function.UndefinedFunction):
        return True
    return False

def _preview_value_latex(val):
    if val is None or callable(val) and not isinstance(val, (sp.Basic, sp.MatrixBase)):
        return None
    if isinstance(val, (sp.Basic, sp.MatrixBase)):
        return sp.latex(val)
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return sp.latex(sp.sympify(val))
    if isinstance(val, (list, tuple, dict)):
        try:
            return sp.latex(sp.sympify(val))
        except Exception:
            return None
    return None

def _target_latex(tgt):
    if isinstance(tgt, ast.Name):
        return sp.latex(sp.Symbol(tgt.id))
    if isinstance(tgt, (ast.Tuple, ast.List)):
        parts = [_target_latex(e) for e in tgt.elts]
        if any(p is None for p in parts):
            return None
        return ', '.join(parts)
    return None

def code_visual_preview(code_str):
    rows = []
    try:
        tree = ast.parse(_preprocess_user_code(code_str or ''), mode='exec')
    except SyntaxError as exc:
        return json.dumps({'status': 'error', 'message': 'Syntax: ' + str(exc), 'rows': []})

    ns = dict(get_eval_locals())
    ns.update({'sp': sp, 'math': math, '_out_ref': _out_ref, '_pv_call': _pv_call,
               '_make_lambda': _make_lambda, '_pe': _pe})
    old_stdout = sys.stdout
    sys.stdout = io.StringIO()
    try:
        body = tree.body[:60]
        for idx_st, st in enumerate(body):
            try:
                if isinstance(st, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.ClassDef)):
                    exec(compile(ast.Module(body=[st], type_ignores=[]), '<preview>', 'exec'), ns)
                    continue
                if isinstance(st, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                    new_st = ast.fix_missing_locations(_PreviewTransformer().visit(st))
                    exec(compile(ast.Module(body=[new_st], type_ignores=[]), '<preview>', 'exec'), ns)
                    targets = st.targets if isinstance(st, ast.Assign) else [st.target]
                    for tgt in targets:
                        if isinstance(tgt, ast.Name):
                            val = ns.get(tgt.id)
                            if _is_symbol_decl(val, [tgt.id]) and isinstance(val, sp.Symbol) and str(val) == tgt.id:
                                continue
                            if isinstance(val, sp.core.function.UndefinedFunction):
                                continue
                            lx = _preview_value_latex(val)
                            if lx and len(lx) < 4000:
                                rows.append({'lhs': _target_latex(tgt), 'latex': lx})
                        elif isinstance(tgt, (ast.Tuple, ast.List)):
                            vals = [ns.get(e.id) if isinstance(e, ast.Name) else None for e in tgt.elts]
                            if _is_symbol_decl(vals, []):
                                continue
                            lx_parts = [_preview_value_latex(v) for v in vals]
                            if all(lx_parts):
                                rows.append({'lhs': _target_latex(tgt), 'latex': ', '.join(lx_parts)})
                    continue
                if isinstance(st, ast.Expr) and idx_st == len(body) - 1:
                    if isinstance(st.value, ast.Call) and isinstance(st.value.func, ast.Name) and st.value.func.id in ('print', 'display'):
                        continue
                    new_val = ast.fix_missing_locations(_PreviewTransformer().visit(ast.Expression(body=st.value)))
                    val = eval(compile(new_val, '<preview>', 'eval'), ns)
                    lx = _preview_value_latex(val)
                    if lx and len(lx) < 4000:
                        rows.append({'lhs': None, 'latex': lx})
                # Loops / conditionals / prints are skipped in the preview (they run on Run Script)
            except Exception:
                continue
    finally:
        sys.stdout = old_stdout
    return json.dumps({'status': 'ok', 'rows': rows[:40]})

# ---------------------------------------------------------------------------
# Multi-tab kernel isolation: each notebook tab owns its own memory namespace
# ---------------------------------------------------------------------------
_tab_sessions = {}
_active_tab_id = None

def switch_session(tab_id):
    global session_vars, session_funcs, session_assumptions, out_history, _active_tab_id
    if _active_tab_id is None:
        _tab_sessions[tab_id] = (session_vars, session_funcs, session_assumptions, out_history)
    elif tab_id != _active_tab_id:
        _tab_sessions[_active_tab_id] = (session_vars, session_funcs, session_assumptions, out_history)
        if tab_id not in _tab_sessions:
            _tab_sessions[tab_id] = ({}, {}, {}, {})
        session_vars, session_funcs, session_assumptions, out_history = _tab_sessions[tab_id]
    _active_tab_id = tab_id
    return json.dumps({'status': 'ok', 'session': serialize_session()})

def drop_session(tab_id):
    if tab_id != _active_tab_id:
        _tab_sessions.pop(tab_id, None)
    return True
def execute_code_cell(code_str, cell_index, assign_to=''):
    if not code_str.strip():
        return json.dumps({
            'status': 'error',
            'message': 'Direct SymPy Code cell is empty. Enter Python/SymPy statements to evaluate.'
        })

    stdout_buf = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = stdout_buf

    try:
        exec_ns = dict(get_eval_locals())
        exec_ns['sp'] = sp
        exec_ns['math'] = math
        exec_ns['_out_ref'] = _out_ref
        exec_ns['_make_lambda'] = _make_lambda
        exec_ns['_pe'] = _pe
        initial_keys = set(exec_ns.keys())
        initial_ids  = {k: id(v) for k, v in exec_ns.items()}

        tree = ast.parse(_preprocess_user_code(code_str), mode='exec')  # accepts math-style f(x) = x^2 sin(x)
        last_expr_val = None

        if tree.body and isinstance(tree.body[-1], ast.Expr):
            # Execute all statements up to the last one, then eval the final expression
            if len(tree.body) > 1:
                mod_head = ast.Module(body=tree.body[:-1], type_ignores=[])
                exec(compile(mod_head, '<sympystudio_cell>', 'exec'), exec_ns)
            last_expr_node = ast.Expression(body=tree.body[-1].value)
            last_expr_val = eval(compile(last_expr_node, '<sympystudio_cell>', 'eval'), exec_ns)
        else:
            exec(compile(tree, '<sympystudio_cell>', 'exec'), exec_ns)

        # Persist newly assigned or modified SymPy symbols/expressions/matrices into session_vars
        last_assigned_sympy = None
        for k, v in exec_ns.items():
            if k.startswith('_') or k in ('sp', 'math', 'result', 'plot_data'):
                continue
            if k not in initial_keys or id(v) != initial_ids.get(k):
                if isinstance(v, (sp.Basic, sp.MatrixBase, int, float, list, tuple, dict)):
                    if isinstance(v, (sp.Basic, sp.MatrixBase)):
                        session_vars[k] = v
                        last_assigned_sympy = v

        # Determine primary result object to render in KaTeX
        if 'result' in exec_ns and exec_ns['result'] is not None and (
            'result' not in initial_keys or id(exec_ns['result']) != initial_ids.get('result')
        ):
            result_obj = exec_ns['result']
        elif last_expr_val is not None:
            result_obj = last_expr_val
        elif last_assigned_sympy is not None:
            result_obj = last_assigned_sympy
        else:
            result_obj = sp.Symbol('Done')

        out_history[cell_index] = result_obj
        assigned_name = None
        if assign_to:
            valid_var = re.sub(r'[^a-zA-Z0-9_]', '', assign_to)
            if valid_var:
                session_vars[valid_var] = result_obj
                assigned_name = valid_var

        approx_latex = None
        try:
            if hasattr(result_obj, 'removeO'):
                num_val = sp.N(result_obj.removeO(), 8)
            elif isinstance(result_obj, list):
                num_val = [sp.N(item, 8) if hasattr(item, 'evalf') else item for item in result_obj]
            else:
                num_val = sp.N(result_obj, 8)
            approx_latex = sp.latex(num_val)
        except Exception:
            approx_latex = None

        custom_plot = exec_ns.get('plot_data', None)
        if not isinstance(custom_plot, dict):
            custom_plot = None

        stdout_text = stdout_buf.getvalue()
        return json.dumps({
            'status': 'ok',
            'latex': sp.latex(result_obj) if result_obj is not None else r'\text{Executed}',
            'approxLatex': approx_latex,
            'sympyCode': code_str,
            'stdout': stdout_text,
            'assigned': assigned_name,
            'warning': None,
            'plotData': custom_plot,
            'session': serialize_session()
        })
    except Exception as exc:
        stdout_text = stdout_buf.getvalue()
        return json.dumps({
            'status': 'error',
            'message': str(exc),
            'stdout': stdout_text
        })
    finally:
        sys.stdout = old_stdout

def execute_notebook_cell(payload_json):
    data = json.loads(payload_json)
    cell_mode = data.get('mode', 'visual')
    raw_latex = data.get('latex', '').strip()
    raw_code  = data.get('code', '').strip()
    op = data.get('operation', 'eval')
    params = data.get('params', {})
    assign_to = data.get('assignTo', '').strip()
    cell_index = int(data.get('inIndex', 1))

    if cell_mode == 'code':
        return execute_code_cell(raw_code, cell_index, assign_to)

    latest_idx = max(out_history.keys()) if out_history else None

    if not raw_latex:
        return json.dumps({
            'status': 'error',
            'message': 'Cell input is empty. Enter an expression using the editor or Math Palettes.'
        })

    try:
        loc = get_eval_locals()
        loc['_out_ref'] = _out_ref
        transformations = standard_transformations + (implicit_multiplication_application, convert_xor)

        sympy_code_shown = ""
        result_obj = None
        assigned_name = None

        cleaned_for_def = latex_to_sympy_str(raw_latex, latest_idx)
        # Detect Function Definition in eval mode: e.g. f(x) = x^2 * sin(x)
        func_def_match = re.match(r'^([a-zA-Z][a-zA-Z0-9_]*)\s*\(([a-zA-Z0-9_,\s]+)\)\s*=\s*(.+)$', cleaned_for_def)
        # Detect Variable Assignment in eval mode: e.g. k = 4.5
        var_def_match = re.match(r'^([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*(.+)$', cleaned_for_def)

        if op == 'ode_solve':
            func_str = params.get('func', 'y(x)').strip()
            fn_match = re.match(r'([a-zA-Z_][a-zA-Z0-9_]*)\(([a-zA-Z_][a-zA-Z0-9_]*)\)', func_str)
            fn_name = fn_match.group(1) if fn_match else 'y'
            indep_name = fn_match.group(2) if fn_match else 'x'

            indep_sym = sp.Symbol(indep_name)
            dep_fn = sp.Function(fn_name)

            ode_clean = latex_to_sympy_str(raw_latex, latest_idx)
            ode_clean = re.sub(rf"\b{fn_name}\s*'''\s*\({indep_name}\)", f"Derivative({fn_name}({indep_name}), ({indep_name}, 3))", ode_clean)
            ode_clean = re.sub(rf"\b{fn_name}\s*''\s*\({indep_name}\)", f"Derivative({fn_name}({indep_name}), ({indep_name}, 2))", ode_clean)
            ode_clean = re.sub(rf"\b{fn_name}\s*'\s*\({indep_name}\)", f"Derivative({fn_name}({indep_name}), {indep_name})", ode_clean)
            ode_clean = re.sub(rf"\b{fn_name}\s*''", f"Derivative({fn_name}({indep_name}), ({indep_name}, 2))", ode_clean)
            ode_clean = re.sub(rf"\b{fn_name}\s*'", f"Derivative({fn_name}({indep_name}), {indep_name})", ode_clean)

            ode_loc = dict(loc)
            ode_loc[fn_name] = dep_fn
            ode_loc[indep_name] = indep_sym

            if '=' in ode_clean:
                lhs_s, rhs_s = ode_clean.split('=', 1)
                lhs_e = parse_expr(lhs_s, local_dict=ode_loc, transformations=transformations)
                rhs_e = parse_expr(rhs_s, local_dict=ode_loc, transformations=transformations)
                ode_eq = sp.Eq(lhs_e, rhs_e)
            else:
                ode_eq = sp.Eq(parse_expr(ode_clean, local_dict=ode_loc, transformations=transformations), 0)

            ics_dict = {}
            for ic_key in ['ic1', 'ic2']:
                ic_raw = params.get(ic_key, '').strip()
                if ic_raw and '=' in ic_raw:
                    ic_lhs, ic_rhs = [p.strip() for p in ic_raw.split('=', 1)]
                    ic_val = parse_expr(latex_to_sympy_str(ic_rhs, latest_idx), local_dict=ode_loc, transformations=transformations)
                    m_der = re.match(rf"{fn_name}('+)\(([^)]+)\)", ic_lhs)
                    m_val = re.match(rf"{fn_name}\(([^)]+)\)", ic_lhs)
                    if m_der:
                        order_ic = len(m_der.group(1))
                        pt_ic = parse_expr(m_der.group(2), local_dict=ode_loc, transformations=transformations)
                        ics_dict[dep_fn(indep_sym).diff(indep_sym, order_ic).subs(indep_sym, pt_ic)] = ic_val
                    elif m_val:
                        pt_ic = parse_expr(m_val.group(1), local_dict=ode_loc, transformations=transformations)
                        ics_dict[dep_fn(pt_ic)] = ic_val

            if ics_dict:
                result_obj = sp.dsolve(ode_eq, dep_fn(indep_sym), ics=ics_dict)
                sympy_code_shown = f"sp.dsolve({repr(ode_eq)}, {fn_name}({indep_name}), ics={repr(ics_dict)})"
            else:
                result_obj = sp.dsolve(ode_eq, dep_fn(indep_sym))
                sympy_code_shown = f"sp.dsolve({repr(ode_eq)}, {fn_name}({indep_name}))"

        elif op == 'eval' and func_def_match and '=' in raw_latex:
            fn_name = func_def_match.group(1).strip()
            args_str = [a.strip() for a in func_def_match.group(2).split(',') if a.strip()]
            rhs_str = func_def_match.group(3).strip()
            arg_syms = [sp.Symbol(a) for a in args_str]
            fn_loc = dict(loc)
            for a_s in arg_syms:
                fn_loc[str(a_s)] = a_s
            rhs_expr = parse_expr(rhs_str, local_dict=fn_loc, transformations=transformations)

            def make_callable(args_tuple, body_expr):
                def _call(*call_args):
                    if len(call_args) != len(args_tuple):
                        raise ValueError(f"Function {fn_name} expects {len(args_tuple)} argument(s).")
                    subs_map = {args_tuple[i]: call_args[i] for i in range(len(args_tuple))}
                    return body_expr.subs(subs_map)
                return _call

            session_funcs[fn_name] = {'args': arg_syms, 'expr': rhs_expr, 'callable': make_callable(arg_syms, rhs_expr)}
            result_obj = rhs_expr
            assigned_name = f"{fn_name}({', '.join(args_str)})"
            sympy_code_shown = f"def {fn_name}({', '.join(args_str)}): return {repr(rhs_expr)}"

        elif var_def_match and '=' in raw_latex and not ('==' in raw_latex):
            v_name = var_def_match.group(1).strip()
            rhs_str = var_def_match.group(2).strip()
            rhs_expr, _ = parse_math_input(rhs_str, latest_idx)

            if op == 'eval':
                res_val = rhs_expr.doit() if hasattr(rhs_expr, 'doit') else rhs_expr
                sympy_code_shown = f"{v_name} = {repr(res_val)}"
            elif op == 'diff':
                v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                order = int(params.get('order', 1) or 1)
                res_val = sp.diff(rhs_expr, v_sym, order)
                sympy_code_shown = f"{v_name} = sp.diff({repr(rhs_expr)}, {v_sym}, {order})"
            elif op == 'integrate_indef':
                v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                res_val = sp.integrate(rhs_expr, v_sym)
                sympy_code_shown = f"{v_name} = sp.integrate({repr(rhs_expr)}, {v_sym})"
            elif op == 'integrate_def':
                v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                a_lim, _ = parse_math_input(str(params.get('lower', '0')), latest_idx)
                b_lim, _ = parse_math_input(str(params.get('upper', 'pi')), latest_idx)
                res_val = sp.integrate(rhs_expr, (v_sym, a_lim, b_lim))
                sympy_code_shown = f"{v_name} = sp.integrate({repr(rhs_expr)}, ({v_sym}, {repr(a_lim)}, {repr(b_lim)}))"
            elif op == 'simplify':
                res_val = sp.simplify(rhs_expr)
                sympy_code_shown = f"{v_name} = sp.simplify({repr(rhs_expr)})"
            elif op == 'expand':
                res_val = sp.expand(rhs_expr)
                sympy_code_shown = f"{v_name} = sp.expand({repr(rhs_expr)})"
            elif op == 'factor':
                res_val = sp.factor(rhs_expr)
                sympy_code_shown = f"{v_name} = sp.factor({repr(rhs_expr)})"
            elif op == 'apart':
                v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                res_val = sp.apart(rhs_expr, v_sym)
                sympy_code_shown = f"{v_name} = sp.apart({repr(rhs_expr)}, {v_sym})"
            elif op == 'trigsimp':
                res_val = sp.trigsimp(rhs_expr)
                sympy_code_shown = f"{v_name} = sp.trigsimp({repr(rhs_expr)})"
            elif op == 'solve':
                v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                res_val = sp.solve(sp.Eq(sp.Symbol(v_name), rhs_expr), v_sym)
                sympy_code_shown = f"sp.solve(sp.Eq(sp.Symbol('{v_name}'), {repr(rhs_expr)}), {v_sym})"
            else:
                res_val = rhs_expr.doit() if hasattr(rhs_expr, 'doit') else rhs_expr
                sympy_code_shown = f"{v_name} = {repr(res_val)}"

            session_vars[v_name] = res_val
            assigned_name = v_name
            result_obj = sp.Eq(sp.Symbol(v_name), res_val) if op != 'solve' else res_val

        elif op == 'solve':
            var_name = params.get('var', 'x').strip() or 'x'
            solve_sym = loc.get(var_name, sp.Symbol(var_name))
            if not isinstance(solve_sym, sp.Symbol):
                solve_sym = sp.Symbol(var_name)
            cleaned = latex_to_sympy_str(raw_latex, latest_idx)
            if '=' in cleaned:
                lhs_s, rhs_s = cleaned.split('=', 1)
                lhs_e = parse_expr(lhs_s, local_dict=loc, transformations=transformations)
                rhs_e = parse_expr(rhs_s, local_dict=loc, transformations=transformations)
                eq_obj = sp.Eq(lhs_e, rhs_e)
            else:
                eq_obj = parse_expr(cleaned, local_dict=loc, transformations=transformations)
            result_obj = sp.solve(eq_obj, solve_sym)
            sympy_code_shown = f"sp.solve({repr(eq_obj)}, {solve_sym})"

        elif op == 'solve_system':
            eq_strings = [raw_latex]
            if params.get('eq2', '').strip():
                eq_strings.append(params.get('eq2').strip())
            if params.get('eq3', '').strip():
                eq_strings.append(params.get('eq3').strip())
            vars_raw = params.get('vars', 'x, y').strip()
            var_syms = [sp.Symbol(v.strip()) for v in vars_raw.split(',') if v.strip()]

            eq_objs = []
            for eq_s in eq_strings:
                c_s = latex_to_sympy_str(eq_s, latest_idx)
                if '=' in c_s:
                    l_s, r_s = c_s.split('=', 1)
                    eq_objs.append(sp.Eq(
                        parse_expr(l_s, local_dict=loc, transformations=transformations),
                        parse_expr(r_s, local_dict=loc, transformations=transformations)
                    ))
                else:
                    eq_objs.append(parse_expr(c_s, local_dict=loc, transformations=transformations))
            result_obj = sp.solve(eq_objs, var_syms, dict=True)
            sympy_code_shown = f"sp.solve({repr(eq_objs)}, {repr(var_syms)}, dict=True)"

        elif op in ('plot_2d', 'plot_parametric', 'plot_3d', 'plot_vector_2d'):
            expr, cleaned_str = parse_math_input(raw_latex, latest_idx)
            result_obj = expr.rhs if isinstance(expr, sp.Equality) else expr
            plot_data, sympy_code_shown = _build_plot_payload(op, expr, raw_latex, params, loc, latest_idx)
            out_history[cell_index] = result_obj
            if assign_to:
                session_vars[assign_to] = result_obj

            return json.dumps({
                'status': 'ok',
                'latex': sp.latex(result_obj),
                'approxLatex': None,
                'sympyCode': sympy_code_shown,
                'assigned': assign_to or assigned_name,
                'plotData': plot_data,
                'session': serialize_session()
            })

        else:
            expr, cleaned_str = parse_math_input(raw_latex, latest_idx)

            if isinstance(expr, sp.Equality):
                def _apply_eq(e):
                    if op == 'eval': return e.doit() if hasattr(e, 'doit') else e
                    elif op == 'simplify': return sp.simplify(e)
                    elif op == 'expand': return sp.expand(e)
                    elif op == 'factor': return sp.factor(e)
                    elif op == 'trigsimp': return sp.trigsimp(e)
                    elif op == 'diff':
                        v_s = sp.Symbol(params.get('var', 'x').strip() or 'x')
                        o_n = int(params.get('order', 1) or 1)
                        return sp.diff(e, v_s, o_n)
                    elif op == 'integrate_indef':
                        v_s = sp.Symbol(params.get('var', 'x').strip() or 'x')
                        return sp.integrate(e, v_s)
                    elif op == 'apart':
                        v_s = sp.Symbol(params.get('var', 'x').strip() or 'x')
                        return sp.apart(e, v_s)
                    return e
                result_obj = sp.Eq(_apply_eq(expr.lhs), _apply_eq(expr.rhs))
                sympy_code_shown = f"sp.Eq({repr(result_obj.lhs)}, {repr(result_obj.rhs)})"

            elif op == 'eval':
                result_obj = expr.doit() if hasattr(expr, 'doit') else expr
                if cleaned_str.startswith(('integrate(', 'diff(', 'limit(', 'summation(', 'product(')):
                    sympy_code_shown = f"sp.{cleaned_str}"
                else:
                    sympy_code_shown = f"{repr(expr)}"

            elif op == 'diff':
                if cleaned_str.startswith('diff('):
                    result_obj = expr.doit() if hasattr(expr, 'doit') else expr
                    sympy_code_shown = f"sp.{cleaned_str}"
                else:
                    v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                    order = int(params.get('order', 1) or 1)
                    result_obj = sp.diff(expr, v_sym, order)
                    sympy_code_shown = f"sp.diff({repr(expr)}, {v_sym}, {order})"

            elif op == 'integrate_indef':
                if cleaned_str.startswith('integrate('):
                    result_obj = expr.doit() if hasattr(expr, 'doit') else expr
                    sympy_code_shown = f"sp.{cleaned_str}"
                else:
                    v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                    result_obj = sp.integrate(expr, v_sym)
                    sympy_code_shown = f"sp.integrate({repr(expr)}, {v_sym})"

            elif op == 'integrate_def':
                if cleaned_str.startswith('integrate('):
                    result_obj = expr.doit() if hasattr(expr, 'doit') else expr
                    sympy_code_shown = f"sp.{cleaned_str}"
                else:
                    v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                    a_lim, _ = parse_math_input(str(params.get('lower', '0')), latest_idx)
                    b_lim, _ = parse_math_input(str(params.get('upper', 'pi')), latest_idx)
                    result_obj = sp.integrate(expr, (v_sym, a_lim, b_lim))
                    sympy_code_shown = f"sp.integrate({repr(expr)}, ({v_sym}, {repr(a_lim)}, {repr(b_lim)}))"

            elif op == 'limit':
                if cleaned_str.startswith('limit('):
                    result_obj = expr.doit() if hasattr(expr, 'doit') else expr
                    sympy_code_shown = f"sp.{cleaned_str}"
                else:
                    v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                    pt_lim, _ = parse_math_input(str(params.get('point', '0')), latest_idx)
                    direction = params.get('dir', '+-')
                    result_obj = sp.limit(expr, v_sym, pt_lim, dir=direction)
                    sympy_code_shown = f"sp.limit({repr(expr)}, {v_sym}, {repr(pt_lim)}, dir='{direction}')"

            elif op == 'series':
                v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                pt_0, _ = parse_math_input(str(params.get('point', '0')), latest_idx)
                order_n = int(params.get('order', 6) or 6)
                result_obj = sp.series(expr, v_sym, pt_0, order_n)
                sympy_code_shown = f"sp.series({repr(expr)}, {v_sym}, {repr(pt_0)}, {order_n})"

            elif op == 'sum':
                if cleaned_str.startswith('summation('):
                    result_obj = expr.doit() if hasattr(expr, 'doit') else expr
                    sympy_code_shown = f"sp.{cleaned_str}"
                else:
                    v_sym = sp.Symbol(params.get('var', 'n').strip() or 'n')
                    a_lim, _ = parse_math_input(str(params.get('lower', '1')), latest_idx)
                    b_lim, _ = parse_math_input(str(params.get('upper', 'oo')), latest_idx)
                    result_obj = sp.summation(expr, (v_sym, a_lim, b_lim))
                    sympy_code_shown = f"sp.summation({repr(expr)}, ({v_sym}, {repr(a_lim)}, {repr(b_lim)}))"

            elif op == 'simplify':
                result_obj = sp.simplify(expr)
                sympy_code_shown = f"sp.simplify({repr(expr)})"

            elif op == 'expand':
                result_obj = sp.expand(expr)
                sympy_code_shown = f"sp.expand({repr(expr)})"

            elif op == 'factor':
                result_obj = sp.factor(expr)
                sympy_code_shown = f"sp.factor({repr(expr)})"

            elif op == 'apart':
                v_sym = sp.Symbol(params.get('var', 'x').strip() or 'x')
                result_obj = sp.apart(expr, v_sym)
                sympy_code_shown = f"sp.apart({repr(expr)}, {v_sym})"

            elif op == 'trigsimp':
                result_obj = sp.trigsimp(expr)
                sympy_code_shown = f"sp.trigsimp({repr(expr)})"

            elif op == 'mat_det':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for determinant calculation.")
                result_obj = expr.det()
                sympy_code_shown = f"({repr(expr)}).det()"

            elif op == 'mat_inv':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for matrix inversion.")
                result_obj = expr.inv()
                sympy_code_shown = f"({repr(expr)}).inv()"

            elif op == 'mat_transpose':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for transpose.")
                result_obj = expr.T
                sympy_code_shown = f"({repr(expr)}).T"

            elif op == 'mat_trace':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for trace.")
                result_obj = expr.trace()
                sympy_code_shown = f"({repr(expr)}).trace()"

            elif op == 'mat_charpoly':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for characteristic polynomial.")
                lam_sym = sp.Symbol(params.get('var', 'lambda').strip() or 'lambda')
                result_obj = expr.charpoly(lam_sym).as_expr()
                sympy_code_shown = f"({repr(expr)}).charpoly({lam_sym}).as_expr()"

            elif op == 'mat_eigen':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Square Matrix for eigen-analysis.")
                evects = expr.eigenvects()
                pieces = []
                for val, mult, basis in evects:
                    basis_ltx = ", ".join([sp.latex(b) for b in basis])
                    pieces.append(r"\lambda = " + sp.latex(val) + r" \; (\text{mult } " + str(mult) + r"), \quad \vec{v} = " + basis_ltx)
                custom_latex = r"\begin{aligned} " + r" \\ ".join(pieces) + r" \end{aligned}"
                out_history[cell_index] = expr
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"({repr(expr)}).eigenvects()",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op in ('vec_grad', 'vec_div', 'vec_curl', 'vec_laplacian'):
                coords_raw = params.get('coords', 'x, y, z')
                c_syms = [sp.Symbol(c.strip()) for c in coords_raw.split(',') if c.strip()]
                if op == 'vec_grad':
                    result_obj = sp.Matrix([sp.diff(expr, c) for c in c_syms])
                    sympy_code_shown = f"sp.Matrix([sp.diff({repr(expr)}, c) for c in {repr(c_syms)}])"
                elif op == 'vec_laplacian':
                    result_obj = sum(sp.diff(expr, c, 2) for c in c_syms)
                    sympy_code_shown = f"sum(sp.diff({repr(expr)}, c, 2) for c in {repr(c_syms)})"
                elif op == 'vec_div':
                    if not isinstance(expr, sp.MatrixBase) or len(expr) != len(c_syms):
                        raise ValueError(f"Divergence requires a {len(c_syms)}-component vector/matrix matching coordinates {coords_raw}.")
                    result_obj = sum(sp.diff(expr[i], c_syms[i]) for i in range(len(c_syms)))
                    sympy_code_shown = f"sum(sp.diff(F[i], coords[i]) for i in range({len(c_syms)}))"
                elif op == 'vec_curl':
                    if not isinstance(expr, sp.MatrixBase) or len(expr) != 3 or len(c_syms) != 3:
                        raise ValueError("Curl requires a 3-component vector [Fx, Fy, Fz] and 3 coordinates (x, y, z).")
                    cx = sp.diff(expr[2], c_syms[1]) - sp.diff(expr[1], c_syms[2])
                    cy = sp.diff(expr[0], c_syms[2]) - sp.diff(expr[2], c_syms[0])
                    cz = sp.diff(expr[1], c_syms[0]) - sp.diff(expr[0], c_syms[1])
                    result_obj = sp.Matrix([cx, cy, cz])
                    sympy_code_shown = f"curl({repr(expr)}, {repr(c_syms)})"

        # Save result into Out[n] history
        out_history[cell_index] = result_obj

        # Handle explicit "Assign to Variable" box
        if assign_to:
            valid_var = re.sub(r'[^a-zA-Z0-9_]', '', assign_to)
            if valid_var:
                session_vars[valid_var] = result_obj
                assigned_name = valid_var
                sympy_code_shown = f"{valid_var} = {sympy_code_shown}"

        # Compute Decimal / Float Approximation via sp.N()
        approx_latex = None
        try:
            if hasattr(result_obj, 'removeO'):
                num_val = sp.N(result_obj.removeO(), 8)
            elif isinstance(result_obj, list):
                num_val = [sp.N(item, 8) if hasattr(item, 'evalf') else item for item in result_obj]
            else:
                num_val = sp.N(result_obj, 8)
            approx_latex = sp.latex(num_val)
        except Exception:
            approx_latex = None

        warning_note = None
        if isinstance(result_obj, sp.Integral) or (hasattr(result_obj, 'has') and result_obj.has(sp.Integral)):
            warning_note = "No closed-form elementary antiderivative found. Try Series Expansion or Decimal Approximation."

        return json.dumps({
            'status': 'ok',
            'latex': sp.latex(result_obj),
            'approxLatex': approx_latex,
            'sympyCode': sympy_code_shown,
            'assigned': assigned_name,
            'warning': warning_note,
            'session': serialize_session()
        })

    except Exception as exc:
        return json.dumps({
            'status': 'error',
            'message': str(exc)
        })
`;

// ============================================================================
// INITIALIZATION & PYODIDE KERNEL SETUP
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initUIHandlers();
  loadNotebookFromStorageOrDefault();
  bootPyodideKernel();
});

async function bootPyodideKernel() {
  setKernelStatus('loading', 'Kernel: Initializing Pyodide & SymPy...');
  try {
    const pyodide = await loadPyodide({
      indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.1/full/'
    });
    setKernelStatus('loading', 'Kernel: Loading SymPy CAS Package...');
    await pyodide.loadPackage(['sympy']);

    await pyodide.runPythonAsync(PYTHON_BOOTSTRAP_CODE);
    await pyodide.runPythonAsync(PYTHON_EVAL_RUNNER);

    AppState.pyodide = pyodide;
    AppState.kernelReady = true;
    setKernelStatus('ready', 'Kernel: Ready (SymPy Active)');

    // Bind the kernel memory to the active notebook tab, restore its assumptions and evaluate it
    const activeTab = getActiveTab();
    if (activeTab) {
      await activateKernelSessionForTab(activeTab);
    }
  } catch (err) {
    console.error('Pyodide initialization error:', err);
    setKernelStatus('error', 'Kernel Error: Failed to load Pyodide');
  }
}

function setKernelStatus(state, text) {
  const pill = document.getElementById('kernelStatusPill');
  const spinner = document.getElementById('kernelSpinner');
  const dot = document.getElementById('kernelDot');
  const label = document.getElementById('kernelStatusText');

  label.textContent = text;
  pill.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ';

  if (state === 'loading' || state === 'busy') {
    pill.classList.add('bg-amber-50', 'text-amber-800', 'border-amber-200');
    spinner.classList.remove('hidden');
    dot.classList.add('hidden');
  } else if (state === 'ready') {
    pill.classList.add('bg-emerald-50', 'text-emerald-800', 'border-emerald-200');
    spinner.classList.add('hidden');
    dot.className = 'w-2 h-2 rounded-full bg-emerald-600';
  } else {
    pill.classList.add('bg-red-50', 'text-red-800', 'border-red-200');
    spinner.classList.add('hidden');
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
      document.getElementById('printTimestamp').textContent = 'Exported on ' + new Date().toLocaleString();
      window.print();
    });
  }

  const btnMobileClearMemory = document.getElementById('btnMobileClearMemory');
  if (btnMobileClearMemory) {
    btnMobileClearMemory.addEventListener('click', async () => {
      if (mobileMoreMenu) mobileMoreMenu.classList.add('hidden');
      if (!AppState.kernelReady) return;
      await AppState.pyodide.runPythonAsync('reset_session_memory()');
      AppState.evalCounter = 0;
      AppState.symbolAssumptions = {};
      updateVariableInspectorUI({ vars: [], outs: [], assumptions: [] });
      saveNotebookToLocalStorage();
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
    document.querySelectorAll('.plotly-output-container:not(.hidden) > div[id^="plot_"]').forEach(plotEl => {
      if (typeof Plotly !== 'undefined' && plotEl && plotEl.data) {
        Plotly.Plots.resize(plotEl);
      }
    });
  });

  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      updateSidebarVisibility();
      document.querySelectorAll('.plotly-output-container:not(.hidden) > div[id^="plot_"]').forEach(plotEl => {
        if (typeof Plotly !== 'undefined' && plotEl && plotEl.data) {
          Plotly.Plots.resize(plotEl);
        }
      });
    }, 200);
  });

  // Apply initial sidebar visibility
  updateSidebarVisibility();

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
  document.getElementById('btnClearMemory').addEventListener('click', async () => {
    if (!AppState.kernelReady) return;
    await AppState.pyodide.runPythonAsync('reset_session_memory()');
    AppState.evalCounter = 0;
    AppState.symbolAssumptions = {};
    updateVariableInspectorUI({ vars: [], outs: [], assumptions: [] });
    saveNotebookToLocalStorage();
  });

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
  document.getElementById('btnExportPrint').addEventListener('click', () => {
    document.getElementById('printTimestamp').textContent = 'Exported on ' + new Date().toLocaleString();
    window.print();
  });

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

  // Dismiss Welcome Banner
  const dismissBtn = document.getElementById('btnDismissBanner');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      document.getElementById('welcomeBanner').classList.add('hidden');
    });
  }

  // Return to Notebook Buttons from Documentation Tab
  const btnBackToNotebook = document.getElementById('btnBackToNotebook');
  if (btnBackToNotebook) {
    btnBackToNotebook.addEventListener('click', () => switchRibbonTab('tab-calculus'));
  }
  const btnDocReturnTop = document.getElementById('btnDocReturnTop');
  if (btnDocReturnTop) {
    btnDocReturnTop.addEventListener('click', () => switchRibbonTab('tab-calculus'));
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

  if (AppState.kernelReady && AppState.pyodide) {
    const payload = { symbols: names.join(', '), positive: pos, real: rl, integer: itg, nonzero: nz };
    AppState.pyodide.globals.set('_assume_payload', JSON.stringify(payload));
    const resJson = await AppState.pyodide.runPythonAsync('apply_symbol_assumptions(_assume_payload)');
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
  if (!AppState.kernelReady || !AppState.pyodide) return;
  const entries = Object.entries(AppState.symbolAssumptions || {});
  for (const [symName, flagsObj] of entries) {
    const payload = {
      symbols: symName,
      positive: !!flagsObj.positive,
      real: !!flagsObj.real,
      integer: !!flagsObj.integer,
      nonzero: !!flagsObj.nonzero
    };
    AppState.pyodide.globals.set('_assume_payload', JSON.stringify(payload));
    const resJson = await AppState.pyodide.runPythonAsync('apply_symbol_assumptions(_assume_payload)');
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

  // Toggle between Live Notebook View and Documentation View when Tab 6 (tab-docs) is selected
  const isDocs = tabId === 'tab-docs';
  const docView = document.getElementById('documentationView');
  const cellsContainer = document.getElementById('notebookCells');
  const bottomAddWrap = document.getElementById('bottomAddCellWrap');
  const welcomeBanner = document.getElementById('welcomeBanner');

  if (docView && cellsContainer && bottomAddWrap) {
    docView.classList.toggle('hidden', !isDocs);
    cellsContainer.classList.toggle('hidden', isDocs);
    bottomAddWrap.classList.toggle('hidden', isDocs);
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
  const op = overrides.operation || 'eval';
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

function buildCellDOM(cell, idx) {
  const wrapper = document.createElement('div');
  wrapper.className = 'notebook-cell-wrapper relative group';
  wrapper.dataset.cellId = cell.id;

  const isCodeMode = cell.mode === 'code';
  const card = document.createElement('article');
  card.className = `notebook-cell p-4 ${isCodeMode ? 'code-mode-cell' : ''} ${AppState.activeCellId === cell.id ? 'active-cell' : ''}`;
  card.id = `dom_${cell.id}`;

  const inLabel = cell.inIndex ? `In [${cell.inIndex}]:` : `In [ ]:`;
  const timeBadge = cell.execTimeMs !== null
    ? `<span class="text-[11px] font-mono text-emerald bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">${cell.execTimeMs} ms</span>`
    : '';

  // Operation Select Dropdown Options
  const opOptionsHtml = Object.entries(OPERATIONS).map(([k, v]) => {
    const sel = cell.operation === k ? 'selected' : '';
    return `<option value="${k}" ${sel}>${v.label}</option>`;
  }).join('');

  const titleBannerHtml = cell.title
    ? `<div class="mb-2 px-2.5 py-1 rounded bg-subtle/80 border-l-2 border-cobalt text-xs font-serif font-semibold text-ink flex items-center justify-between">
         <span>${escapeHtml(cell.title)}</span>
       </div>`
    : '';

  card.innerHTML = `
    ${titleBannerHtml}
    <!-- 1. Cell Header Bar with Dual-Mode Switcher & Bi-Directional Bridge -->
    <div class="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mb-2 pb-1.5 border-b border-borderWarm/70">
      <div class="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <span class="cell-drag-handle cursor-grab text-muted hover:text-ink print-hidden" title="Move Cell Up/Down">
          <button class="btn-move-up hover:text-cobalt px-0.5" title="Move Cell Up">&uarr;</button>
          <button class="btn-move-down hover:text-cobalt px-0.5" title="Move Cell Down">&darr;</button>
        </span>
        <span class="cell-in-badge font-mono font-semibold text-xs text-cobalt bg-blue-50/80 px-1.5 sm:px-2 py-0.5 rounded border border-blue-200/80 select-none">
          ${inLabel}
        </span>
        <span class="cell-mode-label text-xs font-medium text-muted hidden md:inline truncate max-w-[200px]">
          ${isCodeMode ? 'Direct SymPy Code (Python Script)' : (OPERATIONS[cell.operation]?.label || 'Symbolic Evaluation')}
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-1 sm:gap-1.5 print-hidden ml-auto">
        <!-- Dual-Mode Toggle Pill -->
        <div class="inline-flex rounded-md bg-subtle p-0.5 border border-borderWarm text-[11px] font-medium">
          <button type="button" class="btn-mode-visual px-1.5 sm:px-2 py-0.5 rounded transition ${!isCodeMode ? 'bg-surface text-cobalt shadow-2xs font-semibold' : 'text-muted hover:text-ink'}">
            Visual Math
          </button>
          <button type="button" class="btn-mode-code px-1.5 sm:px-2 py-0.5 rounded font-mono transition ${isCodeMode ? 'bg-zinc-900 text-emerald-400 shadow-2xs font-semibold' : 'text-muted hover:text-ink'}">
            SymPy Code
          </button>
        </div>

        <!-- Bi-Directional Bridge Button: Convert Visual Math -> SymPy Code -->
        <button type="button" class="btn-convert-to-code ${isCodeMode ? 'hidden' : 'inline-flex'} items-center gap-1 px-1.5 sm:px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-50 text-emerald-800 hover:bg-emerald-600 hover:text-white border border-emerald-200 transition" title="Convert Visual Equation + Selected Operation into Editable SymPy Python Code">
          <span class="hidden sm:inline">&rarr; Convert to SymPy Code</span>
          <span class="sm:hidden">&rarr; Code</span>
        </button>

        <span class="cell-time-badge hidden sm:inline">${timeBadge}</span>
        <button class="btn-delete-cell text-muted hover:text-red-600 p-1 rounded hover:bg-red-50 transition" title="Delete Cell">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <!-- 2A. Visual MathLive Input Zone -->
    <div class="visual-input-zone mb-3 ${isCodeMode ? 'hidden' : ''}">
      <math-field id="mf_${cell.id}"></math-field>
    </div>

    <!-- 2B. Direct SymPy Code Input Zone (CodeMirror / Python Script) -->
    <div class="code-input-zone mb-3 ${isCodeMode ? '' : 'hidden'}">
      <div class="code-editor-wrapper">
        <textarea id="cm_${cell.id}" class="code-fallback-textarea" spellcheck="false" placeholder="# Enter multi-line Python / SymPy code...&#10;# Assign 'result = ...' or end with an expression on the last line to render in KaTeX."></textarea>
      </div>
      <div class="mt-1 flex items-center justify-between text-[11px] font-mono text-muted px-1">
        <span>Contract: Assign <code class="text-cobalt">result</code> or end with an expression to render KaTeX; <code class="text-emerald">print()</code> / <code class="text-emerald">sp.pprint()</code> streams to terminal log.</span>
        <span class="hidden sm:inline">Shift + Enter to Run</span>
      </div>
      <!-- Live Visual Math rendering of the typed code (updates as you type) -->
      <div class="code-visual-preview mt-2 rounded-md border border-blue-200/80 bg-blue-50/40 hidden">
        <div class="flex items-center justify-between px-2.5 py-1 border-b border-blue-200/70 text-[10px] font-mono uppercase tracking-wider text-cobalt select-none">
          <span>&Sigma; Visual Math (live from code)</span>
          <span class="code-preview-status normal-case tracking-normal text-muted"></span>
        </div>
        <div class="code-preview-body px-3 py-2 space-y-1 overflow-x-auto text-sm"></div>
      </div>
    </div>

    <!-- 3. Execution Controls & Parameter Bar -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-1 text-xs print-hidden">
      <div class="visual-controls-bar flex flex-wrap items-center gap-1.5 sm:gap-2 ${isCodeMode ? 'hidden' : ''}">
        <!-- Operation Selector -->
        <select class="cell-op-select w-full sm:w-auto bg-subtle hover:bg-zinc-200/60 text-ink font-medium rounded px-2.5 py-1.5 border border-borderWarm focus:outline-none focus:border-cobalt cursor-pointer">
          ${opOptionsHtml}
        </select>

        <!-- Dynamic Operation Parameters Container -->
        <div class="cell-params-container flex flex-wrap items-center gap-1.5 sm:gap-2"></div>
      </div>

      <div class="flex items-center justify-between sm:justify-end gap-2 sm:ml-auto w-full sm:w-auto">
        <!-- Assign to Variable Optional Field -->
        <label class="flex items-center gap-1.5 bg-subtle/70 px-2 py-1 rounded border border-borderWarm text-muted">
          <span class="text-[11px] font-mono">Assign:</span>
          <input type="text" class="cell-assign-input w-16 sm:w-20 bg-surface px-1.5 py-0.5 rounded border border-borderWarm font-mono text-xs text-ink focus:outline-none focus:border-cobalt" placeholder="e.g. Sol1" value="${cell.assignTo || ''}" />
        </label>

        <!-- Evaluate Button -->
        <button class="btn-evaluate-cell px-3.5 py-1.5 rounded-md bg-cobalt hover:bg-blue-800 text-white font-semibold shadow-2xs transition flex items-center gap-1.5 ml-auto sm:ml-0">
          <span>${isCodeMode ? 'Run Script' : 'Evaluate'}</span>
          <kbd class="text-[10px] font-mono bg-blue-900/60 px-1 rounded hidden sm:inline">&crarr;</kbd>
        </button>
      </div>
    </div>

    <!-- 4. Output Zone (Out [n]:) -->
    <div class="cell-output-zone mt-3 ${cell.output ? '' : 'hidden'}"></div>
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
  card.querySelector('.btn-mode-visual').addEventListener('click', () => {
    if (cell.mode !== 'visual') {
      switchCellMode(cell, card, 'visual');
    }
  });
  card.querySelector('.btn-mode-code').addEventListener('click', () => {
    if (cell.mode !== 'code') {
      switchCellMode(cell, card, 'code');
    }
  });

  // Bi-Directional Bridge Button ("Convert to SymPy Code")
  card.querySelector('.btn-convert-to-code').addEventListener('click', async () => {
    await convertVisualCellToSympyCode(cell, card);
  });

  // Card click activates cell
  card.addEventListener('mousedown', () => {
    setActiveCell(cell.id, false);
  });

  // Operation Selector Change
  const opSelect = card.querySelector('.cell-op-select');
  opSelect.addEventListener('change', () => {
    const newOp = opSelect.value;
    cell.operation = newOp;
    const opMeta = OPERATIONS[newOp];
    if (opMeta) {
      opMeta.params.forEach(p => {
        if (cell.params[p.key] === undefined) {
          cell.params[p.key] = p.default;
        }
      });
    }
    const modeLabel = card.querySelector('.cell-mode-label');
    if (modeLabel && cell.mode === 'visual') {
      modeLabel.textContent = OPERATIONS[cell.operation]?.label || 'Symbolic Evaluation';
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
  if (!AppState.kernelReady || !AppState.pyodide) {
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
    AppState.pyodide.globals.set('_preview_code', cell.code);
    parsed = JSON.parse(await AppState.pyodide.runPythonAsync('code_visual_preview(_preview_code)'));
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

  const btnVis = card.querySelector('.btn-mode-visual');
  const btnCod = card.querySelector('.btn-mode-code');
  btnVis.className = `btn-mode-visual px-2 py-0.5 rounded transition ${!isCode ? 'bg-surface text-cobalt shadow-2xs font-semibold' : 'text-muted hover:text-ink'}`;
  btnCod.className = `btn-mode-code px-2 py-0.5 rounded font-mono transition ${isCode ? 'bg-zinc-900 text-emerald-400 shadow-2xs font-semibold' : 'text-muted hover:text-ink'}`;

  const evalBtnSpan = card.querySelector('.btn-evaluate-cell span');
  if (evalBtnSpan) evalBtnSpan.textContent = isCode ? 'Run Script' : 'Evaluate';

  const modeLabel = card.querySelector('.cell-mode-label');
  if (modeLabel) {
    modeLabel.textContent = isCode
      ? 'Direct SymPy Code (Python Script)'
      : (OPERATIONS[cell.operation]?.label || 'Symbolic Evaluation');
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
  }
  saveNotebookToLocalStorage();
}

async function convertVisualCellToSympyCode(cell, card) {
  const mf = document.getElementById(`mf_${cell.id}`);
  if (mf) cell.latex = mf.value;

  let generatedCode = '';
  if (AppState.kernelReady && AppState.pyodide) {
    try {
      const payload = {
        latex: cell.latex,
        operation: cell.operation,
        params: cell.params,
        assignTo: cell.assignTo
      };
      AppState.pyodide.globals.set('_conv_payload', JSON.stringify(payload));
      const resJson = await AppState.pyodide.runPythonAsync('convert_visual_to_sympy_code(_conv_payload)');
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
    inputEl.addEventListener('input', () => {
      cell.params[p.key] = inputEl.value;
      saveNotebookToLocalStorage();
    });
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
          <p class="font-semibold">Symbolic Evaluation Notice</p>
          <p class="mt-0.5 font-mono text-[11px] opacity-90">${escapeHtml(out.message)}</p>
          ${errStdout}
          <p class="mt-1 text-[11px] text-amber-800">Check syntax, parentheses, or symbol definitions.</p>
        </div>
      </div>
    `;
    return;
  }

  const outIndexLabel = cell.inIndex ? `Out [${cell.inIndex}]:` : 'Out:';
  const assignedBadge = out.assigned
    ? `<span class="text-[11px] font-mono bg-orange-50 text-terracotta border border-orange-200 px-2 py-0.5 rounded">Assigned &rarr; <strong>${escapeHtml(out.assigned)}</strong></span>`
    : '';

  const warningHtml = out.warning
    ? `<div class="mb-2 px-2.5 py-1.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-center gap-1.5">
         <span>&#9888;</span> <span>${escapeHtml(out.warning)}</span>
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
  if (!AppState.kernelReady || !AppState.pyodide) return;
  try {
    const payload = {
      latex: cell.latex,
      operation: cell.operation,
      params: cell.params,
      paramValues
    };
    AppState.pyodide.globals.set('_slider_payload', JSON.stringify(payload));
    const rawRes = await AppState.pyodide.runPythonAsync('recompute_plot_with_params(_slider_payload)');
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
    const trace = {
      x: plotData.x,
      y: plotData.y,
      mode: 'lines',
      line: { color: '#C2410C', width: 2.5 },
      name: plotData.title || 'Parametric'
    };
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
      }
    };
    plotFn(el, [trace], layout, { responsive: true, displaylogo: false });

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

  if (!AppState.kernelReady || !AppState.pyodide) {
    return;
  }

  setActiveCell(cell.id, false);
  setKernelStatus('busy', 'Kernel: Busy (Evaluating Symbolic Expression)...');

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
    AppState.pyodide.globals.set('_cell_payload_json', JSON.stringify(payload));
    const rawResultJson = await AppState.pyodide.runPythonAsync('execute_notebook_cell(_cell_payload_json)');
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
        plotData: response.plotData || null
      };
      if (response.session) {
        updateVariableInspectorUI(response.session);
      }
    } else {
      cell.output = {
        status: 'error',
        message: response.message || 'Unable to parse or evaluate expression.',
        stdout: response.stdout || ''
      };
    }
  } catch (err) {
    cell.output = {
      status: 'error',
      message: err.message || String(err)
    };
  }

  AppState.kernelBusy = false;
  setKernelStatus('ready', 'Kernel: Ready (SymPy Active)');

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

async function evaluateAllCells() {
  if (!AppState.kernelReady) return;
  const startTabId = AppState.activeTabId;
  for (const cell of AppState.cells.slice()) {
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

function applyOperationToActiveCell(opKey) {
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
    const modeLabel = card.querySelector('.cell-mode-label');
    if (modeLabel) modeLabel.textContent = OPERATIONS[opKey].label;
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
    varsListEl.innerHTML = `<p class="text-muted italic text-xs py-2">No custom symbols or functions assigned yet.</p>`;
  } else {
    varsListEl.innerHTML = '';
    vars.forEach(v => {
      const item = document.createElement('div');
      item.className = 'p-2 rounded bg-paper border border-borderWarm hover:border-cobalt/50 transition cursor-pointer';
      item.title = 'Click to insert symbol into active cell';
      item.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <span class="font-mono font-semibold text-cobalt text-xs">${escapeHtml(v.name)}</span>
          <span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-subtle text-muted">${escapeHtml(v.type)}</span>
        </div>
        <div class="var-katex-preview overflow-x-auto text-xs py-0.5"></div>
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
    outListEl.innerHTML = `<p class="text-muted italic text-xs py-2">Evaluate a cell to populate <code class="font-mono">%1, %2</code> history.</p>`;
  } else {
    outListEl.innerHTML = '';
    outs.slice().reverse().forEach(o => {
      const item = document.createElement('div');
      item.className = 'p-2 rounded bg-paper border border-borderWarm hover:border-terracotta/50 transition cursor-pointer';
      item.title = `Click to insert %${o.index} reference into active cell`;
      item.innerHTML = `
        <div class="flex items-center justify-between mb-1">
          <span class="font-mono font-semibold text-terracotta text-xs">%${o.index}</span>
          <span class="text-[10px] font-mono text-muted">Out[${o.index}]</span>
        </div>
        <div class="out-katex-preview overflow-x-auto text-xs py-0.5"></div>
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

async function activateKernelSessionForTab(tab) {
  if (!AppState.kernelReady || !AppState.pyodide || !tab) return;
  AppState.pyodide.globals.set('_tab_id', tab.id);
  const parsed = JSON.parse(await AppState.pyodide.runPythonAsync('switch_session(_tab_id)'));
  if (!tab.evaluated) {
    tab.evaluated = true;
    await AppState.pyodide.runPythonAsync('reset_session_memory()');
    AppState.evalCounter = 0;
    updateVariableInspectorUI({ vars: [], outs: [], assumptions: [] });
    await syncSavedAssumptionsToKernel();
    await evaluateAllCells();
  } else if (parsed.session) {
    updateVariableInspectorUI(parsed.session);
  }
}

async function switchTab(tabId) {
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
  await activateKernelSessionForTab(target);
}

async function openNewTab(name, cells, symbolAssumptions = {}) {
  const tab = {
    id: makeTabId(),
    name: name || 'Untitled',
    cells: cells && cells.length ? cells : [createCellModel({ mode: 'visual' })],
    symbolAssumptions,
    evalCounter: 0,
    evaluated: false
  };
  AppState.tabs.push(tab);
  await switchTab(tab.id);
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
  if (AppState.kernelReady && AppState.pyodide) {
    AppState.pyodide.globals.set('_drop_tab_id', tab.id);
    await AppState.pyodide.runPythonAsync('drop_session(_drop_tab_id)');
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
    if (autoEval) await activateKernelSessionForTab(current);
  } else {
    await openNewTab(name, cells, {});
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
        // Imported notebooks open in their own tab
        await openNewTab(name, cells, data.symbolAssumptions || {});
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
