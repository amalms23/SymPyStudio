# SymPyStudio — Visual CAS Notebook with Persistent Memory

**SymPyStudio** is a browser-native, Maple/Mathematica-style Computer Algebra System (CAS) notebook designed for undergraduate Engineering and BSc Physics students. All mathematical expressions are entered visually via an interactive typographic equation editor (**MathLive**) and evaluated symbolically in the browser using **SymPy** on **Pyodide (WebAssembly)**.

---

## 1. Architecture & Technical Stack

- **Visual Math Editor**: [MathLive](https://cortexjs.io/mathlive/) (`<math-field>`) for natural typographic input (fractions, integrals, derivatives, roots, limits, matrices, and Greek/physics symbols).
- **Symbolic Computation Kernel**: [Pyodide v0.26.1](https://pyodide.org/) running Python and `sympy` entirely client-side with zero backend dependencies.
- **Mathematical Display Engine**: [KaTeX](https://katex.org/) for crisp, fast LaTeX rendering of symbolic and numerical outputs.
- **Interactive Visualization**: [Plotly.js](https://plotly.com/javascript/) paired with `sp.lambdify` for interactive 2D curves ($y = f(x)$) and 3D surfaces ($z = f(x, y)$).

---

## 2. Persistent Session Memory & `%` Referencing

- **Continuous Session State**: Variables and functions defined in one cell persist across the entire notebook session:
  - **Variable Assignment**: Enter `k = 4.5` or `\omega_0 = \sqrt{\frac{k}{m}}` in *Standard Evaluate* mode, or type a variable name into a cell's `Assign to:` box.
  - **Function Assignment**: Enter `f(x) = x^2 \sin(x)` or `V(x,y) = x^2 - y^2`. Subsequent cells can evaluate `f(\pi/2)`, differentiate `f(x)`, or plot it.
- **Mathematica-Style Output Referencing (`%` and `%n`)**:
  - Every cell evaluation receives an indexed label `In [n]` and `Out [n]`.
  - Reference the immediately preceding result with `%`, or any specific cell output with `%1`, `%2`, etc. (e.g., `%1 + 2 \cdot %2`).
- **Session Memory Inspector Sidebar**:
  - Displays all currently assigned variables, functions, matrices, and `Out[n]` results.
  - Click any entry in the sidebar to insert its symbol or `%n` reference directly into the active cell.
  - Includes a **Clear Memory** button to reset the Python symbol registry without reloading the page.

---

## 3. Categorized Operations Ribbon (6 Tabs)

1. **Tab 1 — Calculus & Analysis**:
   - **Standard Evaluate**: Evaluates expressions, inline integrals/limits/sums, and variable/function assignments.
   - **Differentiate**: Symbolic 1st, 2nd, or $n$-th order derivatives (`sp.diff`).
   - **Indefinite & Definite Integrals**: Symbolic integration (`sp.integrate`) with support for infinite bounds (`oo`, `-oo`) and constants (`pi`).
   - **Limits**: One-sided (`+`, `-`) and two-sided (`+-`) limits (`sp.limit`).
   - **Taylor / Series Expansion**: Power series around $x_0$ up to order $n$ (`sp.series`).
   - **Symbolic Summation**: Closed-form series summations (`sp.summation`).
2. **Tab 2 — Algebra & Solvers**:
   - **Solve for Variable**: Analytical roots of $f(x) = g(x)$ or $f(x) = 0$ (`sp.solve`).
   - **Simultaneous Equations Solver**: Solves linear and non-linear systems of up to 3 equations.
   - **Expression Manipulations**: `Simplify`, `Expand`, `Factor`, `Partial Fractions (apart)`, and `Trig Simplify`.
3. **Tab 3 — Linear Algebra & Vectors**:
   - **Visual Matrix Builder**: Quick $2\times2, 3\times3, 4\times4$ matrix grid insertion plus an interactive modal matrix builder.
   - **Matrix Operations**: Determinant (`det`), Inverse ($A^{-1}$), Transpose ($A^T$), Trace, Characteristic Polynomial, and Eigenvalues/Eigenvectors.
   - **Cartesian Vector Calculus**: Gradient ($\nabla\phi$), Divergence ($\nabla\cdot\vec{F}$), Curl ($\nabla\times\vec{F}$), and Laplacian ($\nabla^2\phi$).
4. **Tab 4 — Differential Equations (ODE)**:
   - **Symbolic ODE Solver**: Solves 1st and 2nd order ODEs via `sp.dsolve` using prime notation (`y''(x) + 2 y'(x) + 10 y(x) = 0`) with optional Initial Conditions (`y(0)=1`, `y'(0)=0`).
5. **Tab 5 — Function & Field Plotter**:
   - **2D Curve Plot**: Plots $y = f(x)$ over $[x_{\min}, x_{\max}]$.
   - **3D Surface Plot**: Interactive 3D surface for $z = f(x, y)$.
6. **Tab 6 — Documentation & Guide**:
   - Built-in interactive reference manual inside the application ribbon with quick-jump navigation.

---

## 4. Keyboard Shortcuts & File Persistence

| Action | Shortcut / Control |
| :--- | :--- |
| Evaluate Active Cell | `Shift + Enter` |
| Move Focus to Previous / Next Cell | `Alt + Up Arrow` / `Alt + Down Arrow` |
| Toggle Floating-Point Approximation (`sp.N`) | Click `Decimal / Float (sp.N)` on any output |
| View Python / SymPy Syntax | Expand `▸ Show Equivalent SymPy Code` |
| Save / Restore Notebook | `Save (.json)` / `Load (.json)` in top header |
| Print / Export PDF | `Export PDF/HTML` in top header |
