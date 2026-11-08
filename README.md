# SymPyStudio

A visual computer-algebra notebook that runs in the browser. You type math in a
[MathLive](https://cortexjs.io/mathlive/) equation editor, choose an operation
(differentiate, solve, integrate, plot, ...), and [SymPy](https://www.sympy.org/)
computes the result in a Python runtime compiled to WebAssembly
([Pyodide](https://pyodide.org/)). Results render with KaTeX, plots with Plotly.

Each cell also has a Python mode with full SymPy, and cells can be converted between the two.

> **Status:** a personal/educational project. SymPy does the math; SymPyStudio's job is
> to translate what you typed into the SymPy expression you meant, show you that
> translation, and stay out of the way. If a result looks wrong, look at the
> **Parsed as** line under the input first.

---

## Contents

1. [Running it](#1-running-it)
2. [How input is read](#2-how-input-is-read)
3. [Notebook features](#3-notebook-features)
4. [Operations](#4-operations)
5. [Engineering suites and presets](#5-engineering-suites-and-presets)
6. [Python code cells](#6-python-code-cells)
7. [Architecture](#7-architecture)
8. [Development](#8-development)
9. [Security and privacy](#9-security-and-privacy)
10. [Known limitations](#10-known-limitations)

---

## 1. Running it

You need a recent Chromium-based browser or Firefox, and an internet connection: the
page loads KaTeX, MathLive, CodeMirror and Plotly from cdnjs/jsDelivr, and the Python
runtime plus SymPy (about 25 MB, cached by the browser after the first visit) from jsDelivr.
Computation itself happens on your machine; no expressions are sent to a server.

**Recommended:** run the bundled server, then open <http://localhost:8000>:

```bash
python tools/serve.py
```

It serves the folder with cross-origin isolation headers, which lets the **Stop** button
interrupt a long computation *without* losing your variables.

**Also works:** opening `index.html` directly, or any static host (GitHub Pages, ...).
Everything works the same, except that Stop has to restart the kernel, which clears the
session's variables (use **Run All** to rebuild them).

---

## 2. How input is read

The LaTeX that MathLive produces is turned into a SymPy expression by a real parser
(`kernel/latex_parser.py`: a tokenizer plus a recursive-descent grammar), not by text
substitution. After every evaluation the cell shows **Parsed as**, i.e. what was
understood, plus a warning whenever a rule below had to guess.

### Symbols and constants

| You type | Meaning |
| :--- | :--- |
| `E`, `I` | Ordinary symbols (Young's modulus, second moment of area, electric field, current, ...) |
| `e` | Euler's number (switchable in **Memory → Input & Kernel Settings**) |
| `i` | Imaginary unit (switchable); a sum/product index such as `\sum_{i=1}^{n}` is always the index |
| `\exponentialE`, `\imaginaryI`, `\mathrm{e}`, `\mathrm{i}` | Always the constants |
| `\pi`, `\infty` | π, ∞ (plain-text fields also accept `pi`, `oo`, `inf`) |
| `\lambda`, `\alpha`, ... | Greek symbols (`\varepsilon` is the same symbol as `\epsilon`, etc.) |
| `v_0`, `x_{12}`, `\sigma_{xx}`, `\mu_0` | Subscripted names are single symbols |

So `\frac{PL^3}{3EI}` is the cantilever tip deflection, and `e^{i\pi}` evaluates to −1.

### Juxtaposition, names and functions

* Letters written next to each other multiply: `xy` is x·y and `2x^2y` is 2x²y.
* A run of letters is merged into one name only if that name already means something:
  a variable or function you defined (`mass = 5` makes `mass` one name afterwards), a
  Greek name of 3+ letters (`theta`), or a function name (`sin`, `sqrt`, ...). Otherwise
  it is split, with a warning: `mass\cdot a` before `mass` exists reads as m·a·s·s·a.
  Write `\mathrm{mass}` to force a single name.
* `f(x)` calls `f` when `f` is a function you defined. For a known symbol, `x(x+1)` is a
  product. An unknown letter followed by parentheses, such as `h(t)`, becomes an undefined
  function, with a warning.
* `\sin x`, `\sin 2x` and `\sin x^2` take the following factors as the argument;
  `\sin x \cos x` is sin(x)·cos(x). `\sin^2 x` is (sin x)², and `\sin^{-1} x` is arcsin x.
* `\ln x` and `\log x` are the natural log; `\log_{10} x` and `\log_2 8` use the given base.
* `|x - |y||` and `\left| ... \right|` are absolute values. `\|v\|` is a norm for vectors.
* `n!`, `\binom{n}{k}`, `30^{\circ}` (degrees → radians), `\sqrt[3]{x}` work as expected.

### Calculus

* **Integrals need a differential:** `\int_0^1 x^2\,dx`, `\int \frac{dx}{x}`, and
  nested ones like `\int_0^1\int_0^x y\,dy\,dx`. If there is none and the integrand has
  exactly one free symbol, that symbol is used, with a warning; otherwise it is an error.
  The integration variable is bound: it is not replaced by a session value of the same name.
* **Derivatives:** `\frac{d}{dx}(...)`, `\frac{d^2}{dx^2}(...)`, `\frac{dy}{dx}`,
  `\frac{\partial^2}{\partial x\partial y}(...)`, `f'(x)` for a defined `f`.
  An unknown `y` in `\frac{dy}{dx}` is treated as a function y(x).
* **Operator scope:** for `\frac{d}{dx}`, `\sum` and `\lim`, a parenthesised operand stops
  at its closing parenthesis (`\frac{d}{dx}(x^2) + 3` = 2x + 3); otherwise the operand runs
  to the end of the sum (`\frac{d}{dx} x^2 + 3x` = 2x + 3).
* `\sum_{n=1}^{\infty}`, `\prod_{k=1}^{5}`, `\lim_{x \to 0^+}`, `\lim_{x\to\infty}` are supported.

### Equations, matrices and vectors

* `=` makes an equation; `<`, `>`, `\le`, `\ge`, `\ne` make relations.
* `name = expr` assigns; `f(x, y) = expr` defines a function (see §3).
* `\begin{pmatrix}...\end{pmatrix}` (also `bmatrix`, `matrix`, `vmatrix` = determinant),
  `[a, b, c]` (column vector), `[[1,2],[3,4]]`. `A^{-1}`, `A^{T}`; `\times` between two
  3-vectors is the cross product and `\cdot` between vectors is the dot product.

Anything else produces an error naming the problem and where it is, for example
`Could not read the input: Integral is missing its differential (e.g. dx)`.

---

## 3. Notebook features

* **Assignments** persist in the notebook tab: `k = 4.5 \cdot 10^3`, `\omega_0 = \sqrt{\frac{k}{m}}`.
  The **Assign:** box on a cell stores that cell's result under a name.
* **Functions:** `f(x) = x^2 \sin(x)`, then `f(\pi)`, `f'(x)`, or use `f` in later cells.
  The argument names are local to the definition.
* **Output recall:** `%` is the latest output and `%3` is `Out[3]`, e.g. `%1 + 2\cdot%2`.
  For an assignment, `%n` recalls the assigned value.
* **Assumptions:** in the Memory panel, declare symbols `positive`, `real`, `integer` or
  `nonzero`. They apply everywhere in the tab, including the variable fields of operations,
  so `\sqrt{x^2}` simplifies to `x` for positive `x`.
* **Tabs:** each tab has its own kernel memory.
* **Stop and time limit:** while a cell runs, its Evaluate button becomes **Stop**. A per-cell
  time limit (default 2 minutes, or none) is set in **Memory → Input & Kernel Settings**.
* **Saving:** the workspace autosaves to the browser's localStorage; **Save/Load** export and
  import `.json` notebooks.

Keyboard: `Shift+Enter` evaluates a cell; `Alt+↑/↓` moves between cells. In the math editor,
`/` makes a fraction, `^`/`_` a superscript/subscript, and `\` starts a LaTeX command.

---

## 4. Operations

Variable fields (`var`, `coords`, ...) accept plain names (`x`, `theta`) or LaTeX (`\theta`).
Limit fields (`lower`, `upper`, `point`) accept math such as `\pi`, `2*pi`, `-oo`.

| Group | Operation | Parameters | SymPy |
| :--- | :--- | :--- | :--- |
| Calculus | Evaluate | | `expr.doit()` |
| | Differentiate | var, order | `diff` |
| | Indefinite / definite integral | var, (lower, upper) | `integrate` |
| | Limit | var, point, direction | `limit` |
| | Taylor series | var, point, order | `series` |
| | Summation | var, lower, upper | `summation` |
| Algebra | Solve, Solve system (≤ 3 equations) | var / vars | `solve` |
| | Simplify, Expand, Factor, Partial fractions, Trig simplify | | `simplify`, `expand`, `factor`, `apart`, `trigsimp` |
| Linear algebra | Determinant, Inverse, Transpose, Trace, Char. polynomial, Eigen | | `Matrix` methods |
| Vector calculus | Gradient, Divergence, Curl, Laplacian | Cartesian / cylindrical / spherical, coords | scale-factor formulas |
| ODEs | ODE solve | function `y(x)`, up to 3 conditions like `y(0)=1`, `y'(0)=0` | `dsolve` |
| Plotting | 2D (with overlays and sliders for free parameters), parametric, 3D surface, 2D vector field | ranges, points | `lambdify` + Plotly |

If the input already contains the operation (for example a typed `\int ... dx` with
the Definite Integral operation selected), the typed operation is evaluated as written.
"Show Equivalent SymPy Code" under each result is runnable Python, with every symbol declared.

---

## 5. Engineering suites and presets

The **Physics Suites** ribbon tab adds:

* **Solid mechanics:** small-strain tensor from a displacement field, Saint-Venant
  compatibility, isotropic Hooke's law (plane stress / plane strain / 3D), stress invariants
  and von Mises stress, Airy stress functions (biharmonic check and stresses), Mohr's circle
  (from `[σx, σy, τxy]` or a 2×2 stress matrix).
* **Electrodynamics:** check of Maxwell's equations for given **E**, **B**, ρ, **J**; fields
  from potentials; Lorenz/Coulomb gauge check; Poynting vector and energy density; Maxwell
  stress tensor and force density.

**Load Template / Suite** opens worked notebooks: calculus starter, damped oscillator,
coupled oscillators, cantilever beam (Airy function and Mohr's circle), 2D elasticity,
Lamé thick cylinder, 3D yield criteria, Kirchhoff plate (Navier series), 2-DOF vibration,
electrostatics, radiating dipole, magnetostatics, TEM plane wave, and a rectangular waveguide.
All 15 presets evaluate without errors. Their physics is the presets' own and is not
independently verified by the test suite.

---

## 6. Python code cells

Switch a cell to **SymPy Code** to write Python. The last expression, or a variable named
`result`, is rendered; `print()` output appears below it. Variables you create join the
session, so visual cells can use them and vice versa. **Sync Code** converts a visual
cell into equivalent Python, and **Sync Math** goes back.

Code cells follow SymPy's conventions: there `E` *is* Euler's number and `I` *is* √−1.
To use a symbol named E in Python, write `E_ = sp.Symbol('E')`, as the generated code does.

---

## 7. Architecture

```
index.html, app.js        UI: notebook cells, MathLive editors, KaTeX/Plotly output
        │  postMessage
        ▼
kernel/worker.js          Web Worker: loads Pyodide + SymPy, runs kernel calls, handles Stop
        │
        ▼
kernel/bootstrap.py       session memory, symbol table, parser glue, assumptions
kernel/latex_parser.py    LaTeX → SymPy parser and SymPy → Python code printer
kernel/runner.py          operations, engineering suites, plotting data, code cells, conversions
```

`kernel_bundle.js` is generated from the `kernel/` files, so the app needs no build step to
run and works from `file://`. The Python never runs on the page's main thread, so the UI
stays responsive during long computations.

---

## 8. Development

```bash
# run the test suite (use SymPy 1.12 to match the browser kernel)
pip install "sympy==1.12" "mpmath==1.3.0"
python -m unittest discover -s tests -v

# after editing anything in kernel/, regenerate the bundle the browser loads
python tools/build_kernel.py
```

* `tests/test_parser.py` pins down how inputs are read (one test per rule in §2).
  When you change the parser, add the input that motivated the change first.
* `tests/test_kernel.py` drives the kernel exactly like the browser does (JSON in, JSON out),
  including checking that generated Python reproduces the visual result.
* CI (`.github/workflows/tests.yml`) runs both and fails if `kernel_bundle.js` is stale.
* **Styles:** `tailwind.css` is prebuilt from `tailwind.config.js`. After adding Tailwind
  classes to `index.html` or `app.js`, rebuild it with the Tailwind v3 CLI (the
  [standalone binary](https://github.com/tailwindlabs/tailwindcss/releases/tag/v3.4.17) needs no Node):

  ```bash
  tailwindcss -c tailwind.config.js -i tools/tailwind.input.css -o tailwind.css --minify
  ```

---

## 9. Security and privacy

* Third-party scripts and styles are pinned to exact versions with Subresource Integrity
  hashes. `pyodide.js` is fetched from official jsDelivr endpoints and checked against a
  pinned SHA-384 before it runs. SymPy and mpmath are checked by Pyodide against the
  SHA-256 hashes in its lock file. The WebAssembly runtime files themselves are not hash-pinned.
* Python runs in a Web Worker, with no access to the page, its DOM or localStorage.
* Notebooks imported from a file that contain Python code ask for confirmation before
  their code cells first run, because Python can still make network requests.

---

## 10. Known limitations

* SymPy can be slow, or never finish, on hard integrals, `simplify`, and large systems.
  Use Stop or the time limit.
* `\log` is the natural logarithm (SymPy's convention), not log₁₀.
* `2.5e3` (digits, `e`, digits) is read as scientific notation, i.e. 2500. To multiply by
  Euler's number write `2.5\cdot e` or `2.5e^{1}`; `2e^{x}` is 2·eˣ as expected.
* ± is not supported; write the two cases as separate cells.
* Safari does not support the isolation mode `tools/serve.py` uses, so there Stop restarts the kernel.
* An internet connection is needed for the libraries and the Python runtime.

---

*SymPyStudio is released under the MIT License.*
