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

# ---------------------------------------------------------------------------
# Suites: Curvilinear Differential Operators & Tensor Analysis
# ---------------------------------------------------------------------------
def _get_curvilinear_metric(system, c_syms):
    if system == 'cylindrical':
        u1, u2, u3 = c_syms[0], c_syms[1], c_syms[2]
        return [u1, u2, u3], [sp.Integer(1), u1, sp.Integer(1)]
    elif system == 'spherical':
        u1, u2, u3 = c_syms[0], c_syms[1], c_syms[2]
        return [u1, u2, u3], [sp.Integer(1), u1, u1 * sp.sin(u2)]
    else:
        # Cartesian
        u1, u2, u3 = c_syms[0], c_syms[1], c_syms[2]
        return [u1, u2, u3], [sp.Integer(1), sp.Integer(1), sp.Integer(1)]

def _curv_grad(phi_expr, system, c_syms):
    coords, h = _get_curvilinear_metric(system, c_syms)
    return sp.Matrix([sp.simplify(sp.diff(phi_expr, coords[i]) / h[i]) for i in range(3)])

def _curv_div(F_vec, system, c_syms):
    coords, h = _get_curvilinear_metric(system, c_syms)
    h_prod = sp.simplify(h[0] * h[1] * h[2])
    t1 = sp.diff(h[1] * h[2] * F_vec[0], coords[0])
    t2 = sp.diff(h[0] * h[2] * F_vec[1], coords[1])
    t3 = sp.diff(h[0] * h[1] * F_vec[2], coords[2])
    return sp.simplify((t1 + t2 + t3) / h_prod)

def _curv_curl(F_vec, system, c_syms):
    coords, h = _get_curvilinear_metric(system, c_syms)
    c1 = sp.simplify((sp.diff(h[2] * F_vec[2], coords[1]) - sp.diff(h[1] * F_vec[1], coords[2])) / (h[1] * h[2]))
    c2 = sp.simplify((sp.diff(h[0] * F_vec[0], coords[2]) - sp.diff(h[2] * F_vec[2], coords[0])) / (h[0] * h[2]))
    c3 = sp.simplify((sp.diff(h[1] * F_vec[1], coords[0]) - sp.diff(h[0] * F_vec[0], coords[1])) / (h[0] * h[1]))
    return sp.Matrix([c1, c2, c3])

def _curv_laplacian(phi_expr, system, c_syms):
    coords, h = _get_curvilinear_metric(system, c_syms)
    h_prod = sp.simplify(h[0] * h[1] * h[2])
    t1 = sp.diff((h[1] * h[2] / h[0]) * sp.diff(phi_expr, coords[0]), coords[0])
    t2 = sp.diff((h[0] * h[2] / h[1]) * sp.diff(phi_expr, coords[1]), coords[1])
    t3 = sp.diff((h[0] * h[1] / h[2]) * sp.diff(phi_expr, coords[2]), coords[2])
    return sp.simplify((t1 + t2 + t3) / h_prod)

def _mech_strain(expr, c_syms):
    dim = len(c_syms)
    if not isinstance(expr, sp.MatrixBase):
        if isinstance(expr, (list, tuple)):
            expr = sp.Matrix(expr)
        else:
            raise ValueError(f"Displacement must be a {dim}-element vector [u, v] or [u, v, w].")
    if len(expr) != dim:
        dim = len(expr)
        c_syms = [sp.Symbol('x'), sp.Symbol('y'), sp.Symbol('z')][:dim]
    eps = sp.zeros(dim, dim)
    for i in range(dim):
        for j in range(dim):
            dij = sp.diff(expr[i], c_syms[j])
            dji = sp.diff(expr[j], c_syms[i])
            eps[i, j] = sp.simplify(sp.Rational(1, 2) * (dij + dji))
    return eps

def _mech_compat(eps, c_syms):
    dim = eps.rows if isinstance(eps, sp.MatrixBase) else 2
    if dim == 2:
        x_s, y_s = c_syms[0], c_syms[1]
        e_xx, e_yy, e_xy = eps[0, 0], eps[1, 1], eps[0, 1]
        res = sp.simplify(sp.diff(e_xx, y_s, 2) + sp.diff(e_yy, x_s, 2) - 2 * sp.diff(e_xy, x_s, y_s))
        return {'dim': 2, 'satisfied': res == 0, 'residual': res}
    else:
        # 3D
        x_s, y_s, z_s = c_syms[0], c_syms[1], c_syms[2]
        s11 = sp.simplify(sp.diff(eps[1, 1], z_s, 2) + sp.diff(eps[2, 2], y_s, 2) - 2 * sp.diff(eps[1, 2], y_s, z_s))
        s22 = sp.simplify(sp.diff(eps[2, 2], x_s, 2) + sp.diff(eps[0, 0], z_s, 2) - 2 * sp.diff(eps[2, 0], z_s, x_s))
        s33 = sp.simplify(sp.diff(eps[0, 0], y_s, 2) + sp.diff(eps[1, 1], x_s, 2) - 2 * sp.diff(eps[0, 1], x_s, y_s))
        s12 = sp.simplify(sp.diff(-sp.diff(eps[0, 1], z_s) + sp.diff(eps[1, 2], x_s) + sp.diff(eps[2, 0], y_s), z_s) - sp.diff(eps[2, 2], x_s, y_s))
        s23 = sp.simplify(sp.diff(-sp.diff(eps[1, 2], x_s) + sp.diff(eps[2, 0], y_s) + sp.diff(eps[0, 1], z_s), x_s) - sp.diff(eps[0, 0], y_s, z_s))
        s31 = sp.simplify(sp.diff(-sp.diff(eps[2, 0], y_s) + sp.diff(eps[0, 1], z_s) + sp.diff(eps[1, 2], x_s), y_s) - sp.diff(eps[1, 1], z_s, x_s))
        residuals = [s11, s22, s33, s12, s23, s31]
        satisfied = all(r == 0 for r in residuals)
        return {'dim': 3, 'satisfied': satisfied, 'residuals': residuals}

def _mech_hooke(expr, state, direction, E_sym, nu_sym):
    if not isinstance(expr, sp.MatrixBase):
        raise ValueError("Input must be a 2x2 or 3x3 strain/stress Matrix.")
    dim = expr.rows
    if state == 'plane_stress':
        if direction == 'strain_to_stress':
            e11, e22, e12 = expr[0, 0], expr[1, 1], expr[0, 1]
            factor = E_sym / (1 - nu_sym**2)
            s11 = sp.simplify(factor * (e11 + nu_sym * e22))
            s22 = sp.simplify(factor * (e22 + nu_sym * e11))
            s12 = sp.simplify((E_sym / (1 + nu_sym)) * e12)
            return sp.Matrix([[s11, s12], [s12, s22]])
        else:
            s11, s22, s12 = expr[0, 0], expr[1, 1], expr[0, 1]
            e11 = sp.simplify((s11 - nu_sym * s22) / E_sym)
            e22 = sp.simplify((s22 - nu_sym * s11) / E_sym)
            e12 = sp.simplify(((1 + nu_sym) / E_sym) * s12)
            return sp.Matrix([[e11, e12], [e12, e22]])
    elif state == 'plane_strain':
        if direction == 'strain_to_stress':
            e11, e22, e12 = expr[0, 0], expr[1, 1], expr[0, 1]
            factor = E_sym / ((1 + nu_sym) * (1 - 2 * nu_sym))
            s11 = sp.simplify(factor * ((1 - nu_sym) * e11 + nu_sym * e22))
            s22 = sp.simplify(factor * ((1 - nu_sym) * e22 + nu_sym * e11))
            s12 = sp.simplify((E_sym / (1 + nu_sym)) * e12)
            s33 = sp.simplify(nu_sym * (s11 + s22))
            return sp.Matrix([[s11, s12, 0], [s12, s22, 0], [0, 0, s33]])
        else:
            s11, s22, s12 = expr[0, 0], expr[1, 1], expr[0, 1]
            factor = (1 + nu_sym) / E_sym
            e11 = sp.simplify(factor * ((1 - nu_sym) * s11 - nu_sym * s22))
            e22 = sp.simplify(factor * ((1 - nu_sym) * s22 - nu_sym * s11))
            e12 = sp.simplify(factor * s12)
            return sp.Matrix([[e11, e12], [e12, e22]])
    else:
        # 3D isotropic
        lam_val = (E_sym * nu_sym) / ((1 + nu_sym) * (1 - 2 * nu_sym))
        mu_val = E_sym / (2 * (1 + nu_sym))
        if direction == 'strain_to_stress':
            tr_eps = sp.simplify(expr[0, 0] + expr[1, 1] + expr[2, 2])
            sig = sp.zeros(3, 3)
            for i in range(3):
                for j in range(3):
                    kronecker = 1 if i == j else 0
                    sig[i, j] = sp.simplify(2 * mu_val * expr[i, j] + lam_val * tr_eps * kronecker)
            return sig
        else:
            tr_sig = sp.simplify(expr[0, 0] + expr[1, 1] + expr[2, 2])
            eps = sp.zeros(3, 3)
            for i in range(3):
                for j in range(3):
                    kronecker = 1 if i == j else 0
                    eps[i, j] = sp.simplify((expr[i, j] - (nu_sym / (1 + nu_sym)) * tr_sig * kronecker) / (2 * mu_val))
            return eps

def _mech_invariants(expr):
    if not isinstance(expr, sp.MatrixBase):
        if isinstance(expr, (list, tuple)) and len(expr) in (3, 6):
            if len(expr) == 3:
                expr = sp.Matrix([[expr[0], expr[2], 0], [expr[2], expr[1], 0], [0, 0, 0]])
        else:
            raise ValueError("Input must be a 2x2 or 3x3 stress Matrix or [sx, sy, txy].")
    if expr.rows == 2:
        expr = sp.Matrix([[expr[0, 0], expr[0, 1], 0], [expr[1, 0], expr[1, 1], 0], [0, 0, 0]])
    I1 = sp.simplify(expr.trace())
    sig_m = sp.simplify(I1 / 3)
    S = sp.simplify(expr - sig_m * sp.eye(3))
    I2 = sp.simplify(sp.Rational(1, 2) * (I1**2 - (expr**2).trace()))
    I3 = sp.simplify(expr.det())
    J2 = sp.simplify(sp.Rational(1, 2) * (S**2).trace())
    J3 = sp.simplify(S.det())
    sigma_vm = sp.simplify(sp.sqrt(3 * J2))
    return {
        'sigma': expr,
        'I1': I1,
        'I2': I2,
        'I3': I3,
        'S': S,
        'J2': J2,
        'J3': J3,
        'sigma_vm': sigma_vm
    }

def _mech_airy(phi_expr, c_syms):
    x_s, y_s = c_syms[0], c_syms[1]
    sig_xx = sp.simplify(sp.diff(phi_expr, y_s, 2))
    sig_yy = sp.simplify(sp.diff(phi_expr, x_s, 2))
    tau_xy = sp.simplify(-sp.diff(phi_expr, x_s, y_s))
    biharmonic = sp.simplify(sp.diff(phi_expr, x_s, 4) + 2 * sp.diff(phi_expr, x_s, 2, y_s, 2) + sp.diff(phi_expr, y_s, 4))
    sig_mat = sp.Matrix([[sig_xx, tau_xy], [tau_xy, sig_yy]])
    return {
        'biharmonic': biharmonic,
        'is_biharmonic': biharmonic == 0,
        'stress_matrix': sig_mat
    }

def _mech_mohr(expr):
    if isinstance(expr, sp.MatrixBase) and 1 in expr.shape and len(expr) >= 3:
        sig_x, sig_y, tau_xy = expr[0], expr[1], expr[2]
    elif isinstance(expr, sp.MatrixBase):
        sig_x, sig_y, tau_xy = expr[0, 0], expr[1, 1], expr[0, 1]
    elif isinstance(expr, (list, tuple)) and len(expr) >= 3:
        sig_x, sig_y, tau_xy = expr[0], expr[1], expr[2]
    else:
        raise ValueError("Mohr's circle requires [sigma_x, sigma_y, tau_xy] or a 2x2 stress matrix.")
    sig_avg = sp.simplify(sp.Rational(1, 2) * (sig_x + sig_y))
    R = sp.simplify(sp.sqrt(sp.Rational(1, 4) * (sig_x - sig_y)**2 + tau_xy**2))
    sig_1 = sp.simplify(sig_avg + R)
    sig_2 = sp.simplify(sig_avg - R)
    tau_max = R
    theta_p = sp.simplify(sp.Rational(1, 2) * sp.atan2(2 * tau_xy, sig_x - sig_y))
    return {
        'sig_x': sig_x, 'sig_y': sig_y, 'tau_xy': tau_xy,
        'sig_avg': sig_avg, 'R': R,
        'sig_1': sig_1, 'sig_2': sig_2,
        'tau_max': tau_max, 'theta_p': theta_p
    }

def _em_maxwell_check(fields_expr, c_syms, t_sym, rho_expr, J_expr):
    if isinstance(fields_expr, sp.MatrixBase) and fields_expr.rows == 2 and fields_expr.cols == 3:
        E_vec = sp.Matrix(fields_expr.row(0))
        B_vec = sp.Matrix(fields_expr.row(1))
    elif isinstance(fields_expr, (list, tuple)) and len(fields_expr) == 2:
        E_vec = sp.Matrix(fields_expr[0])
        B_vec = sp.Matrix(fields_expr[1])
    else:
        raise ValueError("Candidate EM fields must be provided as pair [E, B] of 3D vectors.")
    eps_0 = sp.Symbol('epsilon_0', positive=True)
    mu_0_sym = sp.Symbol('mu_0', positive=True)

    div_E = sum(sp.diff(E_vec[i], c_syms[i]) for i in range(3))
    div_B = sum(sp.diff(B_vec[i], c_syms[i]) for i in range(3))

    curl_E = sp.Matrix([
        sp.diff(E_vec[2], c_syms[1]) - sp.diff(E_vec[1], c_syms[2]),
        sp.diff(E_vec[0], c_syms[2]) - sp.diff(E_vec[2], c_syms[0]),
        sp.diff(E_vec[1], c_syms[0]) - sp.diff(E_vec[0], c_syms[1])
    ])
    curl_B = sp.Matrix([
        sp.diff(B_vec[2], c_syms[1]) - sp.diff(B_vec[1], c_syms[2]),
        sp.diff(B_vec[0], c_syms[2]) - sp.diff(B_vec[2], c_syms[0]),
        sp.diff(B_vec[1], c_syms[0]) - sp.diff(B_vec[0], c_syms[1])
    ])

    dt_B = sp.Matrix([sp.diff(B_vec[i], t_sym) for i in range(3)])
    dt_E = sp.Matrix([sp.diff(E_vec[i], t_sym) for i in range(3)])

    res_gauss_E = sp.simplify(div_E - rho_expr / eps_0)
    res_gauss_B = sp.simplify(div_B)
    res_faraday = sp.simplify(curl_E + dt_B)
    res_ampere = sp.simplify(curl_B - mu_0_sym * eps_0 * dt_E - mu_0_sym * sp.Matrix(J_expr))

    return {
        'gauss_E': {'res': res_gauss_E, 'ok': res_gauss_E == 0},
        'gauss_B': {'res': res_gauss_B, 'ok': res_gauss_B == 0},
        'faraday': {'res': res_faraday, 'ok': all(r == 0 for r in res_faraday)},
        'ampere': {'res': res_ampere, 'ok': all(r == 0 for r in res_ampere)}
    }

def _em_potentials(A_vec, V_expr, c_syms, t_sym):
    if not isinstance(A_vec, sp.MatrixBase):
        A_vec = sp.Matrix(A_vec)
    B_vec = sp.Matrix([
        sp.diff(A_vec[2], c_syms[1]) - sp.diff(A_vec[1], c_syms[2]),
        sp.diff(A_vec[0], c_syms[2]) - sp.diff(A_vec[2], c_syms[0]),
        sp.diff(A_vec[1], c_syms[0]) - sp.diff(A_vec[0], c_syms[1])
    ])
    grad_V = sp.Matrix([sp.diff(V_expr, c) for c in c_syms])
    dt_A = sp.Matrix([sp.diff(A_vec[i], t_sym) for i in range(3)])
    E_vec = sp.simplify(-grad_V - dt_A)
    return {'E': E_vec, 'B': sp.simplify(B_vec)}

def _em_gauge(A_vec, V_expr, c_syms, t_sym, c_speed):
    if not isinstance(A_vec, sp.MatrixBase):
        A_vec = sp.Matrix(A_vec)
    div_A = sp.simplify(sum(sp.diff(A_vec[i], c_syms[i]) for i in range(3)))
    dt_V = sp.diff(V_expr, t_sym)
    lorenz_res = sp.simplify(div_A + (sp.Integer(1) / (c_speed**2)) * dt_V)
    coulomb_res = div_A
    return {
        'lorenz_ok': lorenz_res == 0,
        'lorenz_res': lorenz_res,
        'coulomb_ok': coulomb_res == 0,
        'coulomb_res': coulomb_res
    }

def _em_poynting(fields_expr):
    if isinstance(fields_expr, sp.MatrixBase) and fields_expr.rows == 2 and fields_expr.cols == 3:
        E_vec = fields_expr.row(0)
        B_vec = fields_expr.row(1)
    elif isinstance(fields_expr, (list, tuple)) and len(fields_expr) == 2:
        E_vec = fields_expr[0]
        B_vec = fields_expr[1]
    else:
        raise ValueError("Poynting computation requires pair [E, B] of 3D vectors.")
    mu_0_sym = sp.Symbol('mu_0', positive=True)
    eps_0 = sp.Symbol('epsilon_0', positive=True)
    sx = (E_vec[1] * B_vec[2] - E_vec[2] * B_vec[1]) / mu_0_sym
    sy = (E_vec[2] * B_vec[0] - E_vec[0] * B_vec[2]) / mu_0_sym
    sz = (E_vec[0] * B_vec[1] - E_vec[1] * B_vec[0]) / mu_0_sym
    S_vec = sp.Matrix([sp.simplify(sx), sp.simplify(sy), sp.simplify(sz)])
    E_sq = sum(E_vec[i]**2 for i in range(3))
    B_sq = sum(B_vec[i]**2 for i in range(3))
    u_dens = sp.simplify(sp.Rational(1, 2) * eps_0 * E_sq + sp.Rational(1, 2) * (sp.Integer(1) / mu_0_sym) * B_sq)
    g_mom = sp.simplify(eps_0 * mu_0_sym * S_vec)
    return {'S': S_vec, 'u': u_dens, 'g': g_mom}

def _em_stress_tensor(fields_expr, c_syms):
    if isinstance(fields_expr, sp.MatrixBase) and fields_expr.rows == 2 and fields_expr.cols == 3:
        E_vec = fields_expr.row(0)
        B_vec = fields_expr.row(1)
    elif isinstance(fields_expr, (list, tuple)) and len(fields_expr) == 2:
        E_vec = fields_expr[0]
        B_vec = fields_expr[1]
    else:
        raise ValueError("Maxwell stress tensor requires pair [E, B] of 3D vectors.")
    eps_0 = sp.Symbol('epsilon_0', positive=True)
    mu_0_sym = sp.Symbol('mu_0', positive=True)
    E_sq = sum(E_vec[i]**2 for i in range(3))
    B_sq = sum(B_vec[i]**2 for i in range(3))
    T = sp.zeros(3, 3)
    for i in range(3):
        for j in range(3):
            delta_ij = 1 if i == j else 0
            e_part = eps_0 * (E_vec[i] * E_vec[j] - sp.Rational(1, 2) * delta_ij * E_sq)
            b_part = (sp.Integer(1) / mu_0_sym) * (B_vec[i] * B_vec[j] - sp.Rational(1, 2) * delta_ij * B_sq)
            T[i, j] = sp.simplify(e_part + b_part)
    f_vec = sp.Matrix([sp.simplify(sum(sp.diff(T[i, j], c_syms[j]) for j in range(3))) for i in range(3)])
    return {'T': T, 'f': f_vec}

def _build_plot_payload(op, expr, raw_latex, params, loc, latest_idx, param_overrides=None):
    transformations = standard_transformations + (implicit_multiplication_application, convert_xor)

    if op == 'plot_2d':
        v_name = params.get('var', 'x').strip() or 'x'
        v_sym = _sym(v_name)
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
        v_sym = _sym(v_name)
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

    elif op in ('plot_vector_2d', 'em_field_plot'):
        xmin = float(sp.N(parse_expr(str(params.get('xmin', '-5' if op == 'em_field_plot' else '-4')), local_dict=loc)))
        xmax = float(sp.N(parse_expr(str(params.get('xmax', '5' if op == 'em_field_plot' else '4')), local_dict=loc)))
        ymin = float(sp.N(parse_expr(str(params.get('ymin', '-5' if op == 'em_field_plot' else '-4')), local_dict=loc)))
        ymax = float(sp.N(parse_expr(str(params.get('ymax', '5' if op == 'em_field_plot' else '4')), local_dict=loc)))
        grid_n = max(6, min(30, int(params.get('grid', 16 if op == 'em_field_plot' else 15) or 15)))

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
        title_str = f"2D Vector Field Quiver: {vec_label}"
        try:
            div_val = sp.simplify(sp.diff(fx_expr, x_sym) + sp.diff(fy_expr, y_sym))
            curl_val = sp.simplify(sp.diff(fy_expr, x_sym) - sp.diff(fx_expr, y_sym))
            title_str = f"2D Vector Field: {vec_label} | ∇·F = {sp.latex(div_val)}, (∇×F)_z = {sp.latex(curl_val)}"
        except Exception:
            pass
        return {
            'type': 'vector_2d',
            'quiverX': quiver_x,
            'quiverY': quiver_y,
            'xmin': xmin, 'xmax': xmax, 'ymin': ymin, 'ymax': ymax,
            'title': title_str,
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


def _friendly_error(exc):
    """Readable message for an exception raised while parsing/evaluating a cell."""
    if isinstance(exc, LatexParseError):
        return f"Could not read the input: {exc}"
    msg = str(exc) or exc.__class__.__name__
    return msg


class _CodeBuilder:
    """Collects code lines whose expression parts are printed once all symbols are known,
    so the generated script declares every symbol (with assumptions) exactly once."""

    def __init__(self):
        self.lines = []
        self.exprs = []

    def e(self, value):
        self.exprs.append(value)
        return ('expr', value)

    def add(self, *parts):
        self.lines.append(parts)

    def render(self, header):
        decl, renames = symbol_declarations(self.exprs)
        out = [header] + decl
        for parts in self.lines:
            out.append(''.join(to_code(p[1], renames) if isinstance(p, tuple) else p for p in parts))
        return '\n'.join(out)


_CURV_HELPERS = {'curv_grad': '_curv_grad', 'curv_div': '_curv_div', 'curv_curl': '_curv_curl',
                 'curv_laplacian': '_curv_laplacian'}


def convert_visual_to_sympy_code(payload_json):
    data = json.loads(payload_json)
    raw_latex = data.get('latex', '').strip()
    op = OPERATION_ALIASES_PY.get(data.get('operation', 'eval'), data.get('operation', 'eval'))
    params = data.get('params', {})
    assign_to = re.sub(r'[^a-zA-Z0-9_]', '', data.get('assignTo', '').strip())
    latest_idx = max(out_history.keys()) if out_history else None

    try:
        if raw_latex:
            stmt = parse_latex_statement(raw_latex, make_parse_ctx(latest_idx))
            if stmt.kind == 'funcdef' and op != 'eval':
                stmt = Statement('expr', parse_latex_expr(raw_latex, make_parse_ctx(latest_idx)))
        else:
            stmt = Statement('expr', sp.Integer(0))
    except Exception as exc:
        return json.dumps({'status': 'error', 'message': _friendly_error(exc)})

    cb = _CodeBuilder()
    E = cb.e

    def V(name, default='x'):
        return E(_sym(name, default))

    def PL(key, default):
        return E(parse_math_full(str(params.get(key, default)), latest_idx)[0])

    lhs = assign_to or 'result'
    main = stmt.expr

    if stmt.kind == 'funcdef':
        fn_py = python_name(stmt.name)
        args = stmt.args
        cb.add(fn_py, ' = sp.Lambda(', E(sp.Tuple(*args)), ', ', E(main), ')')
        cb.add('result = ', fn_py, '(', ', '.join(python_name(a.name) for a in args), ')')
    elif stmt.kind == 'assign':
        v_py = python_name(stmt.name)
        if op == 'diff':
            cb.add(v_py, ' = sp.diff(', E(main), ', ', V(params.get('var')), f", {int(params.get('order', 1) or 1)})")
        elif op in ('integrate_indef', 'apart'):
            cb.add(v_py, f" = sp.{'integrate' if op == 'integrate_indef' else 'apart'}(", E(main), ', ', V(params.get('var')), ')')
        elif op == 'integrate_def':
            cb.add(v_py, ' = sp.integrate(', E(main), ', (', V(params.get('var')), ', ', PL('lower', '0'), ', ', PL('upper', 'pi'), '))')
        elif op in ('simplify', 'expand', 'factor', 'trigsimp'):
            cb.add(v_py, f' = sp.{op}(', E(main), ')')
        elif op == 'solve':
            cb.add('eq = sp.Eq(', E(_sym(stmt.name)), ', ', E(main), ')')
            cb.add(lhs, ' = sp.solve(eq, ', V(params.get('var')), ')')
        else:
            cb.add(v_py, ' = ', E(main), '.doit()' if _has_calculus(main) else '')
        if lhs == 'result' and op != 'solve':
            cb.add('result = ', v_py)
    elif op == 'eval':
        cb.add(lhs, ' = ', E(main), '.doit()' if _has_calculus(main) else '')
    elif op == 'diff':
        cb.add('expr = ', E(main))
        cb.add(lhs, ' = sp.diff(expr, ', V(params.get('var')), f", {int(params.get('order', 1) or 1)})")
    elif op in ('integrate_indef', 'apart'):
        cb.add('expr = ', E(main))
        cb.add(lhs, f" = sp.{'integrate' if op == 'integrate_indef' else 'apart'}(expr, ", V(params.get('var')), ')')
    elif op == 'integrate_def':
        cb.add('expr = ', E(main))
        cb.add(lhs, ' = sp.integrate(expr, (', V(params.get('var')), ', ', PL('lower', '0'), ', ', PL('upper', 'pi'), '))')
    elif op == 'limit':
        cb.add('expr = ', E(main))
        cb.add(lhs, ' = sp.limit(expr, ', V(params.get('var')), ', ', PL('point', '0'), f", dir='{params.get('dir', '+-')}')")
    elif op == 'series':
        cb.add('expr = ', E(main))
        cb.add(lhs, ' = sp.series(expr, ', V(params.get('var')), ', ', PL('point', '0'), f", {int(params.get('order', 6) or 6)})")
    elif op == 'sum':
        cb.add('expr = ', E(main))
        cb.add(lhs, ' = sp.summation(expr, (', V(params.get('var'), 'n'), ', ', PL('lower', '1'), ', ', PL('upper', 'oo'), '))')
    elif op == 'solve':
        cb.add('eq = ', E(main))
        cb.add(lhs, ' = sp.solve(eq, ', V(params.get('var')), ')')
    elif op == 'solve_system':
        eqs = [main] + [parse_math_full(params[k], latest_idx)[0] for k in ('eq2', 'eq3') if str(params.get(k, '')).strip()]
        cb.add('eqs = ', E(eqs))
        cb.add(lhs, ' = sp.solve(eqs, ', E(_syms(params.get('vars', 'x, y'), 'x, y')), ', dict=True)')
    elif op in ('simplify', 'expand', 'factor', 'trigsimp'):
        cb.add('expr = ', E(main))
        cb.add(lhs, f' = sp.{op}(expr)')
    elif op == 'ode_solve':
        func_str = (params.get('func', 'y(x)') or 'y(x)').strip()
        fn_match = re.match(r'([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\)', func_str)
        fn_name = fn_match.group(1) if fn_match else 'y'
        indep = _sym(fn_match.group(2) if fn_match else 'x')
        ode = parse_latex_expr(raw_latex, make_parse_ctx(latest_idx, {fn_name: indep}))
        if not isinstance(ode, sp.Equality):
            ode = sp.Eq(ode, 0)
        cb.add('ode = ', E(ode))
        cb.add(lhs, ' = sp.dsolve(ode, ', E(sp.Function(fn_name)(indep)), ')')
    elif op in _CURV_HELPERS:
        sys_val = params.get('system', 'cartesian')
        default_coords = {'cartesian': 'x, y, z', 'cylindrical': 'r, theta, z', 'spherical': 'r, theta, phi'}
        coords_raw = (params.get('coords', '') or '').strip()
        if not coords_raw or (sys_val != 'cartesian' and coords_raw == 'x, y, z'):
            coords_raw = default_coords.get(sys_val, 'x, y, z')
        field_val = main if op in ('curv_grad', 'curv_laplacian') or isinstance(main, sp.MatrixBase) else sp.Matrix(main)
        cb.add(f"# {op.split('_')[1].capitalize()} in {sys_val} coordinates ({coords_raw})")
        cb.add('field = ', E(field_val))
        cb.add(lhs, f" = {_CURV_HELPERS[op]}(field, '{sys_val}', ", E(_syms(coords_raw)), ')')
    elif op in ('mech_strain', 'mech_compat', 'mech_airy'):
        coords = _syms(params.get('coords', 'x, y' if op == 'mech_airy' else 'x, y, z'))
        cb.add('field = ', E(main))
        suffix = "['stress_matrix']" if op == 'mech_airy' else ''
        cb.add(lhs, f' = _{op}(field, ', E(coords), ')' + suffix)
    elif op == 'mech_hooke':
        st = params.get('state', 'plane_stress')
        dr = params.get('direction', 'strain_to_stress')
        cb.add(f"# Hooke's law: {st} ({dr})")
        cb.add('tensor_in = ', E(main))
        cb.add(lhs, f" = _mech_hooke(tensor_in, '{st}', '{dr}', ", V(params.get('E'), 'E'), ', ', V(params.get('nu'), 'nu'), ')')
    elif op == 'mech_invariants':
        cb.add('sig = ', E(main))
        cb.add(lhs, " = _mech_invariants(sig)['sigma_vm']")
    elif op == 'mech_mohr':
        cb.add('stress_input = ', E(main))
        cb.add('mohr_data = _mech_mohr(stress_input)')
        cb.add(lhs, " = sp.Matrix([mohr_data['sig_1'], mohr_data['sig_2'], mohr_data['tau_max']])")
    elif op == 'em_maxwell_check':
        cb.add('fields = ', E(main))
        cb.add(lhs, ' = _em_maxwell_check(fields, ', E(_syms(params.get('coords', 'x, y, z'))), ', ', V(params.get('time'), 't'),
               ', ', PL('rho', '0'), ', ', PL('J', '[0, 0, 0]'), ')')
    elif op in ('em_potentials', 'em_gauge'):
        cb.add('A = ', E(main))
        cb.add('V = ', PL('V', '0'))
        extra = (', ', V(params.get('c'), 'c')) if op == 'em_gauge' else ()
        cb.add(lhs, f' = _{op}(A, V, ', E(_syms(params.get('coords', 'x, y, z'))), ', ', V(params.get('time'), 't'), *extra, ')')
    elif op == 'em_poynting':
        cb.add('fields = ', E(main))
        cb.add(lhs, " = _em_poynting(fields)['S']")
    elif op == 'em_stress_tensor':
        cb.add('fields = ', E(main))
        cb.add(lhs, ' = _em_stress_tensor(fields, ', E(_syms(params.get('coords', 'x, y, z'))), ")['T']")
    else:
        cb.add('expr = ', E(main))
        cb.add(lhs, ' = expr')

    if lhs != 'result':
        cb.add('result = ', lhs)
    return json.dumps({'status': 'ok', 'code': cb.render('# Converted from Visual Math Mode')})


OPERATION_ALIASES_PY = {'vec_grad': 'curv_grad', 'vec_div': 'curv_div', 'vec_curl': 'curv_curl',
                        'vec_laplacian': 'curv_laplacian', 'em_field_plot': 'plot_vector_2d'}


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

def convert_code_to_visual(code_str):
    code_str = (code_str or '').strip()
    if not code_str:
        return json.dumps({'status': 'ok', 'latex': '', 'operation': 'eval', 'params': {}, 'assignTo': ''})

    cleaned_code = _preprocess_user_code(code_str)
    try:
        tree = ast.parse(cleaned_code, mode='exec')
    except Exception as exc:
        try:
            expr, _ = parse_math_input(code_str)
            return json.dumps({'status': 'ok', 'latex': sp.latex(expr), 'operation': 'eval', 'params': {}, 'assignTo': ''})
        except Exception:
            return json.dumps({'status': 'error', 'message': f'Syntax error in code: {exc}'})

    ns = dict(get_eval_locals())
    ns.update({'sp': sp, 'math': math, '_out_ref': _out_ref, '_make_lambda': _make_lambda, '_pe': _pe})

    detected_op = 'eval'
    detected_params = {}
    detected_assign_to = ''

    def match_op_call(node):
        if not isinstance(node, ast.Call):
            return None, None, {}
        fn_name = ''
        if isinstance(node.func, ast.Attribute):
            fn_name = node.func.attr
        elif isinstance(node.func, ast.Name):
            fn_name = node.func.id

        if fn_name == 'expand' and len(node.args) >= 1:
            return 'expand', node.args[0], {}
        elif fn_name == 'factor' and len(node.args) >= 1:
            return 'factor', node.args[0], {}
        elif fn_name == 'simplify' and len(node.args) >= 1:
            return 'simplify', node.args[0], {}
        elif fn_name == 'trigsimp' and len(node.args) >= 1:
            return 'trigsimp', node.args[0], {}
        elif fn_name == 'apart' and len(node.args) >= 1:
            p = {'var': 'x'}
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Name):
                p['var'] = node.args[1].id
            return 'apart', node.args[0], p
        elif fn_name == 'diff' and len(node.args) >= 1:
            p = {'var': 'x', 'order': 1}
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Name):
                p['var'] = node.args[1].id
            if len(node.args) >= 3 and isinstance(node.args[2], ast.Constant) and isinstance(node.args[2].value, int):
                p['order'] = node.args[2].value
            return 'diff', node.args[0], p
        elif fn_name == 'integrate' and len(node.args) >= 1:
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Tuple) and len(node.args[1].elts) == 3:
                tup = node.args[1].elts
                v_name = tup[0].id if isinstance(tup[0], ast.Name) else 'x'
                low_val = eval(compile(ast.Expression(body=tup[1]), '<conv>', 'eval'), ns)
                upp_val = eval(compile(ast.Expression(body=tup[2]), '<conv>', 'eval'), ns)
                return 'integrate_def', node.args[0], {'var': v_name, 'lower': sp.latex(low_val), 'upper': sp.latex(upp_val)}
            else:
                p = {'var': 'x'}
                if len(node.args) >= 2 and isinstance(node.args[1], ast.Name):
                    p['var'] = node.args[1].id
                return 'integrate_indef', node.args[0], p
        elif fn_name == 'limit' and len(node.args) >= 3:
            v_name = node.args[1].id if isinstance(node.args[1], ast.Name) else 'x'
            pt_val = eval(compile(ast.Expression(body=node.args[2]), '<conv>', 'eval'), ns)
            d = '+-'
            for kw in node.keywords:
                if kw.arg == 'dir' and isinstance(kw.value, ast.Constant):
                    d = str(kw.value.value)
            return 'limit', node.args[0], {'var': v_name, 'point': sp.latex(pt_val), 'dir': d}
        elif fn_name == 'series' and len(node.args) >= 1:
            p = {'var': 'x', 'point': '0', 'order': 6}
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Name):
                p['var'] = node.args[1].id
            if len(node.args) >= 3:
                pt_val = eval(compile(ast.Expression(body=node.args[2]), '<conv>', 'eval'), ns)
                p['point'] = sp.latex(pt_val)
            if len(node.args) >= 4 and isinstance(node.args[3], ast.Constant) and isinstance(node.args[3].value, int):
                p['order'] = node.args[3].value
            return 'series', node.args[0], p
        elif fn_name == 'summation' and len(node.args) >= 2:
            p = {'var': 'n', 'lower': '1', 'upper': 'oo'}
            if isinstance(node.args[1], ast.Tuple) and len(node.args[1].elts) == 3:
                tup = node.args[1].elts
                p['var'] = tup[0].id if isinstance(tup[0], ast.Name) else 'n'
                low_val = eval(compile(ast.Expression(body=tup[1]), '<conv>', 'eval'), ns)
                upp_val = eval(compile(ast.Expression(body=tup[2]), '<conv>', 'eval'), ns)
                p['lower'] = sp.latex(low_val)
                p['upper'] = sp.latex(upp_val)
            return 'sum', node.args[0], p
        elif fn_name == 'solve' and len(node.args) >= 1:
            p = {'var': 'x'}
            if len(node.args) >= 2 and isinstance(node.args[1], ast.Name):
                p['var'] = node.args[1].id
            return 'solve', node.args[0], p
        elif fn_name in ('_curv_grad', 'grad') and len(node.args) >= 1:
            return 'curv_grad', node.args[0], {}
        elif fn_name in ('_curv_div', 'div') and len(node.args) >= 1:
            return 'curv_div', node.args[0], {}
        elif fn_name in ('_curv_curl', 'curl') and len(node.args) >= 1:
            return 'curv_curl', node.args[0], {}
        elif fn_name in ('_curv_laplacian', 'laplacian') and len(node.args) >= 1:
            return 'curv_laplacian', node.args[0], {}
        elif fn_name in ('_mech_strain', 'mech_strain') and len(node.args) >= 1:
            return 'mech_strain', node.args[0], {}
        elif fn_name in ('_mech_compat', 'mech_compat') and len(node.args) >= 1:
            return 'mech_compat', node.args[0], {}
        elif fn_name in ('_mech_hooke', 'mech_hooke') and len(node.args) >= 1:
            return 'mech_hooke', node.args[0], {}
        elif fn_name in ('_mech_invariants', 'mech_invariants') and len(node.args) >= 1:
            return 'mech_invariants', node.args[0], {}
        elif fn_name in ('_mech_airy', 'mech_airy') and len(node.args) >= 1:
            return 'mech_airy', node.args[0], {}
        elif fn_name in ('_mech_mohr', 'mech_mohr') and len(node.args) >= 1:
            return 'mech_mohr', node.args[0], {}
        elif fn_name in ('_em_maxwell_check', 'em_maxwell_check') and len(node.args) >= 1:
            return 'em_maxwell_check', node.args[0], {}
        elif fn_name in ('_em_potentials', 'em_potentials') and len(node.args) >= 1:
            return 'em_potentials', node.args[0], {}
        elif fn_name in ('_em_gauge', 'em_gauge') and len(node.args) >= 1:
            return 'em_gauge', node.args[0], {}
        elif fn_name in ('_em_poynting', 'em_poynting') and len(node.args) >= 1:
            return 'em_poynting', node.args[0], {}
        elif fn_name in ('_em_stress_tensor', 'em_stress_tensor') and len(node.args) >= 1:
            return 'em_stress_tensor', node.args[0], {}
        return None, None, {}

    last_assign = None
    last_expr = None
    for st in tree.body:
        try:
            if isinstance(st, (ast.Import, ast.ImportFrom, ast.FunctionDef)):
                exec(compile(ast.Module(body=[st], type_ignores=[]), '<conv>', 'exec'), ns)
            elif isinstance(st, ast.Assign):
                exec(compile(ast.Module(body=[st], type_ignores=[]), '<conv>', 'exec'), ns)
                targets = [t.id for t in st.targets if isinstance(t, ast.Name)]
                if targets:
                    last_assign = st
            elif isinstance(st, ast.Expr):
                last_expr = st
        except Exception:
            pass

    eval_target_node = None
    if last_assign is not None:
        tgt_name = last_assign.targets[0].id if isinstance(last_assign.targets[0], ast.Name) else 'result'
        rhs_node = last_assign.value
        op_found, inner_arg_node, op_params = match_op_call(rhs_node)
        if op_found:
            detected_op = op_found
            detected_params = op_params
            eval_target_node = inner_arg_node
        else:
            eval_target_node = rhs_node
            if tgt_name not in ('result', 'expr'):
                detected_assign_to = tgt_name
    elif last_expr is not None:
        op_found, inner_arg_node, op_params = match_op_call(last_expr.value)
        if op_found:
            detected_op = op_found
            detected_params = op_params
            eval_target_node = inner_arg_node
        else:
            eval_target_node = last_expr.value

    target_latex = ''
    if eval_target_node is not None:
        try:
            val = eval(compile(ast.Expression(body=eval_target_node), '<conv>', 'eval'), ns)
            target_latex = sp.latex(val)
        except Exception:
            try:
                target_latex = ast.unparse(eval_target_node)
            except Exception:
                target_latex = ''

    if detected_assign_to and detected_op == 'eval':
        target_latex = f"{detected_assign_to} = {target_latex}" if target_latex else detected_assign_to
        detected_assign_to = ''

    return json.dumps({
        'status': 'ok',
        'latex': target_latex,
        'operation': detected_op,
        'params': detected_params,
        'assignTo': detected_assign_to
    })

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
        exec_ns.update({k_h: v_h for k_h, v_h in globals().items() if k_h.startswith(('_curv_', '_mech_', '_em_'))})
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

_last_parse = {'echo': None, 'warnings': []}


def execute_notebook_cell(payload_json):
    """Evaluate one cell; adds what the parser understood ('parsedLatex') and any parse warnings."""
    _last_parse['echo'] = None
    _last_parse['warnings'] = []
    out = json.loads(_execute_notebook_cell_impl(payload_json))
    if out.get('parsedLatex') is None:
        out['parsedLatex'] = _echo_latex(_last_parse['echo'])
    out.setdefault('warnings', list(_last_parse['warnings']))
    return json.dumps(out)


def _op_on(e, op, params):
    """Apply a simple single-expression operation (used for both sides of equations)."""
    if op == 'eval':
        return evaluate_calculus(e)
    if op == 'simplify':
        return sp.simplify(e)
    if op == 'expand':
        return sp.expand(e)
    if op == 'factor':
        return sp.factor(e)
    if op == 'trigsimp':
        return sp.trigsimp(e)
    if op == 'diff':
        return sp.diff(e, _sym(params.get('var')), int(params.get('order', 1) or 1))
    if op == 'integrate_indef':
        return sp.integrate(e, _sym(params.get('var')))
    if op == 'apart':
        return sp.apart(e, _sym(params.get('var')))
    return e


def _has_calculus(e):
    return isinstance(e, (sp.Basic, sp.MatrixBase)) and e.has(*_CALCULUS_NODES)


def _echo_latex(parsed):
    """LaTeX of what the parser understood (shown under the input as 'Parsed as')."""
    if parsed is None:
        return None
    try:
        if isinstance(parsed, (list, tuple)):
            return r',\quad '.join(sp.latex(p) for p in parsed)
        return sp.latex(parsed)
    except Exception:
        return None


def _execute_notebook_cell_impl(payload_json):
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

        sympy_code_shown = ""
        result_obj = None
        assigned_name = None
        history_value = None

        def _param_expr(key, default):
            val, _ = parse_math_input(str(params.get(key, default)), latest_idx)
            return val

        if op == 'ode_solve':
            func_str = (params.get('func', 'y(x)') or 'y(x)').strip()
            fn_match = re.match(r'\\?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*\\?([a-zA-Z_][a-zA-Z0-9_]*)\s*\)', func_str)
            fn_name = fn_match.group(1) if fn_match else 'y'
            indep_sym = _sym(fn_match.group(2) if fn_match else 'x')
            dep_fn = sp.Function(fn_name)
            dependent = {fn_name: indep_sym}

            ctx = make_parse_ctx(latest_idx, dependent)
            ode = parse_latex_expr(raw_latex, ctx)
            _last_parse['warnings'] = ctx.warnings
            if not isinstance(ode, sp.Equality):
                ode = sp.Eq(ode, 0)
            _last_parse['echo'] = ode
            ode_eq = sp.Eq(evaluate_calculus(ode.lhs), evaluate_calculus(ode.rhs))

            ics_dict = {}
            for ic_key in ['ic1', 'ic2', 'ic3']:
                ic_raw = (params.get(ic_key, '') or '').strip()
                if not ic_raw:
                    continue
                ic = parse_latex_expr(ic_raw, make_parse_ctx(latest_idx, dependent))
                if not isinstance(ic, sp.Equality):
                    raise ValueError(f"Initial condition '{ic_raw}' must look like {fn_name}(0) = 1 or {fn_name}'(0) = 0")
                ics_dict[ic.lhs] = ic.rhs

            decl, pc = code_for(ode_eq)
            if ics_dict:
                result_obj = sp.dsolve(ode_eq, dep_fn(indep_sym), ics=ics_dict)
                ics_code = '{' + ', '.join(f"{pc(k_ic)}: {pc(v_ic)}" for k_ic, v_ic in ics_dict.items()) + '}'
                sympy_code_shown = '\n'.join(decl + [f"sp.dsolve({pc(ode_eq)}, {pc(dep_fn(indep_sym))}, ics={ics_code})"])
            else:
                result_obj = sp.dsolve(ode_eq, dep_fn(indep_sym))
                sympy_code_shown = '\n'.join(decl + [f"sp.dsolve({pc(ode_eq)}, {pc(dep_fn(indep_sym))})"])

        elif op in ('solve', 'solve_system'):
            eq_inputs = [raw_latex]
            if op == 'solve_system':
                eq_inputs += [params.get(k_eq, '').strip() for k_eq in ('eq2', 'eq3') if params.get(k_eq, '').strip()]
            eq_objs = []
            for eq_s in eq_inputs:
                ctx = make_parse_ctx(latest_idx)
                stmt = parse_latex_statement(eq_s, ctx)
                _last_parse['warnings'] += [w for w in ctx.warnings if w not in _last_parse['warnings']]
                if stmt.kind == 'assign':
                    # "y = x^2 + 1" solved for a variable: keep it as an equation
                    eq_objs.append(sp.Eq(_sym(stmt.name), evaluate_calculus(stmt.expr)))
                elif stmt.kind == 'funcdef':
                    eq_objs.append(parse_latex_expr(eq_s, make_parse_ctx(latest_idx)))
                else:
                    eq_objs.append(evaluate_calculus(stmt.expr))
            _last_parse['echo'] = eq_objs[0] if len(eq_objs) == 1 else eq_objs
            decl, pc = code_for(*eq_objs)
            if op == 'solve':
                solve_sym = _sym(params.get('var'))
                result_obj = sp.solve(eq_objs[0], solve_sym)
                sympy_code_shown = '\n'.join(decl + [f"sp.solve({pc(eq_objs[0])}, {pc(solve_sym)})"])
            else:
                var_syms = _syms(params.get('vars', 'x, y'), 'x, y')
                result_obj = sp.solve(eq_objs, var_syms, dict=True)
                sympy_code_shown = '\n'.join(decl + [f"sp.solve({pc(eq_objs)}, {pc(var_syms)}, dict=True)"])

        else:
            ctx = make_parse_ctx(latest_idx)
            stmt = parse_latex_statement(raw_latex, ctx, allow_definitions=True)
            if stmt.kind == 'funcdef' and op != 'eval':
                ctx = make_parse_ctx(latest_idx)
                stmt = Statement('expr', parse_latex_expr(raw_latex, ctx))
            _last_parse['warnings'] = ctx.warnings
            _last_parse['echo'] = stmt.expr
            uneval = stmt.expr
            expr = evaluate_calculus(uneval)
            decl, pc = code_for(uneval)
            is_calc = _has_calculus(uneval)

            if stmt.kind == 'funcdef':
                fn_name = stmt.name
                arg_syms = stmt.args
                body = expr
                session_funcs[fn_name] = {'args': arg_syms, 'expr': body, 'callable': _UserFunction(fn_name, arg_syms, body)}
                result_obj = body
                assigned_name = f"{fn_name}({', '.join(str(a) for a in arg_syms)})"
                decl, pc = code_for(body)
                arg_tuple = '(' + ', '.join(pc(a) for a in arg_syms) + (',)' if len(arg_syms) == 1 else ')')
                sympy_code_shown = '\n'.join(decl + [f"{python_name(fn_name)} = sp.Lambda({arg_tuple}, {pc(body)})"])
                _last_parse['echo'] = sp.Eq(sp.Function(fn_name)(*arg_syms), uneval, evaluate=False)

            elif stmt.kind == 'assign':
                v_name = stmt.name
                py_v = python_name(v_name)
                if op in ('eval', 'simplify', 'expand', 'factor', 'trigsimp', 'diff', 'integrate_indef', 'apart'):
                    res_val = _op_on(expr, op, params)
                    if op == 'eval':
                        line = f"{py_v} = {pc(uneval)}" + ('.doit()' if is_calc else '')
                    elif op == 'diff':
                        line = f"{py_v} = sp.diff({pc(expr)}, {pc(_sym(params.get('var')))}, {int(params.get('order', 1) or 1)})"
                    elif op in ('integrate_indef', 'apart'):
                        fn_nm = 'integrate' if op == 'integrate_indef' else 'apart'
                        line = f"{py_v} = sp.{fn_nm}({pc(expr)}, {pc(_sym(params.get('var')))})"
                    else:
                        line = f"{py_v} = sp.{op}({pc(expr)})"
                elif op == 'integrate_def':
                    v_sym = _sym(params.get('var'))
                    a_lim, b_lim = _param_expr('lower', '0'), _param_expr('upper', 'pi')
                    res_val = sp.integrate(expr, (v_sym, a_lim, b_lim))
                    line = f"{py_v} = sp.integrate({pc(expr)}, ({pc(v_sym)}, {pc(a_lim)}, {pc(b_lim)}))"
                else:
                    res_val = expr
                    line = f"{py_v} = {pc(uneval)}"
                sympy_code_shown = '\n'.join(decl + [line])
                session_vars[v_name] = res_val
                history_value = res_val
                assigned_name = v_name
                result_obj = sp.Eq(sp.Symbol(v_name), res_val, evaluate=False)
                _last_parse['echo'] = sp.Eq(sp.Symbol(v_name), uneval, evaluate=False)

            elif op in ('plot_2d', 'plot_parametric', 'plot_3d', 'plot_vector_2d', 'em_field_plot'):
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
                    'parsedLatex': _echo_latex(_last_parse['echo']),
                    'warnings': _last_parse['warnings'],
                    'session': serialize_session()
                })

            elif isinstance(expr, sp.Equality) and op in ('eval', 'simplify', 'expand', 'factor', 'trigsimp', 'diff', 'integrate_indef', 'apart'):
                result_obj = sp.Eq(_op_on(expr.lhs, op, params), _op_on(expr.rhs, op, params))
                sympy_code_shown = '\n'.join(decl + [f"sp.Eq({pc(result_obj.lhs)}, {pc(result_obj.rhs)})"])

            elif op == 'eval':
                result_obj = expr
                sympy_code_shown = '\n'.join(decl + [pc(uneval) + ('.doit()' if is_calc else '')])

            elif op in ('diff', 'integrate_indef', 'integrate_def', 'limit', 'sum') and \
                    isinstance(uneval, {'diff': sp.Derivative, 'integrate_indef': sp.Integral, 'integrate_def': sp.Integral,
                                        'limit': sp.Limit, 'sum': sp.Sum}[op]):
                # the input already contains the operation (e.g. a typed \int ... dx)
                result_obj = expr
                sympy_code_shown = '\n'.join(decl + [pc(uneval) + '.doit()'])

            elif op == 'diff':
                v_sym = _sym(params.get('var'))
                order = int(params.get('order', 1) or 1)
                result_obj = sp.diff(expr, v_sym, order)
                sympy_code_shown = '\n'.join(decl + [f"sp.diff({pc(expr)}, {pc(v_sym)}, {order})"])

            elif op == 'integrate_indef':
                v_sym = _sym(params.get('var'))
                result_obj = sp.integrate(expr, v_sym)
                sympy_code_shown = '\n'.join(decl + [f"sp.integrate({pc(expr)}, {pc(v_sym)})"])

            elif op == 'integrate_def':
                v_sym = _sym(params.get('var'))
                a_lim, b_lim = _param_expr('lower', '0'), _param_expr('upper', 'pi')
                result_obj = sp.integrate(expr, (v_sym, a_lim, b_lim))
                sympy_code_shown = '\n'.join(decl + [f"sp.integrate({pc(expr)}, ({pc(v_sym)}, {pc(a_lim)}, {pc(b_lim)}))"])

            elif op == 'limit':
                v_sym = _sym(params.get('var'))
                pt_lim = _param_expr('point', '0')
                direction = params.get('dir', '+-')
                if direction == '+-' and pt_lim in (sp.oo, -sp.oo):
                    direction = '-' if pt_lim == sp.oo else '+'
                result_obj = sp.limit(expr, v_sym, pt_lim, dir=direction)
                sympy_code_shown = '\n'.join(decl + [f"sp.limit({pc(expr)}, {pc(v_sym)}, {pc(pt_lim)}, dir='{direction}')"])

            elif op == 'series':
                v_sym = _sym(params.get('var'))
                pt_0 = _param_expr('point', '0')
                order_n = int(params.get('order', 6) or 6)
                result_obj = sp.series(expr, v_sym, pt_0, order_n)
                sympy_code_shown = '\n'.join(decl + [f"sp.series({pc(expr)}, {pc(v_sym)}, {pc(pt_0)}, {order_n})"])

            elif op == 'sum':
                v_sym = _sym(params.get('var'), 'n')
                a_lim, b_lim = _param_expr('lower', '1'), _param_expr('upper', 'oo')
                result_obj = sp.summation(expr, (v_sym, a_lim, b_lim))
                sympy_code_shown = '\n'.join(decl + [f"sp.summation({pc(expr)}, ({pc(v_sym)}, {pc(a_lim)}, {pc(b_lim)}))"])

            elif op == 'simplify':
                result_obj = sp.simplify(expr)
                sympy_code_shown = f"sp.simplify({pc(expr)})"

            elif op == 'expand':
                result_obj = sp.expand(expr)
                sympy_code_shown = f"sp.expand({pc(expr)})"

            elif op == 'factor':
                result_obj = sp.factor(expr)
                sympy_code_shown = f"sp.factor({pc(expr)})"

            elif op == 'apart':
                v_sym = _sym(params.get('var'), 'x')
                result_obj = sp.apart(expr, v_sym)
                sympy_code_shown = f"sp.apart({pc(expr)}, {v_sym})"

            elif op == 'trigsimp':
                result_obj = sp.trigsimp(expr)
                sympy_code_shown = f"sp.trigsimp({pc(expr)})"

            elif op == 'mat_det':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for determinant calculation.")
                result_obj = expr.det()
                sympy_code_shown = f"({pc(expr)}).det()"

            elif op == 'mat_inv':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for matrix inversion.")
                result_obj = expr.inv()
                sympy_code_shown = f"({pc(expr)}).inv()"

            elif op == 'mat_transpose':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for transpose.")
                result_obj = expr.T
                sympy_code_shown = f"({pc(expr)}).T"

            elif op == 'mat_trace':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for trace.")
                result_obj = expr.trace()
                sympy_code_shown = f"({pc(expr)}).trace()"

            elif op == 'mat_charpoly':
                if not isinstance(expr, sp.MatrixBase):
                    raise ValueError("Input must be a Matrix for characteristic polynomial.")
                lam_sym = _sym(params.get('var'), 'lambda')
                result_obj = expr.charpoly(lam_sym).as_expr()
                sympy_code_shown = f"({pc(expr)}).charpoly({lam_sym}).as_expr()"

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
                    'sympyCode': f"({pc(expr)}).eigenvects()",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op in ('curv_grad', 'curv_div', 'curv_curl', 'curv_laplacian', 'vec_grad', 'vec_div', 'vec_curl', 'vec_laplacian'):
                system = params.get('system', 'cartesian')
                default_coords_map = {'cartesian': 'x, y, z', 'cylindrical': 'r, theta, z', 'spherical': 'r, theta, phi'}
                coords_raw = (params.get('coords', '') or '').strip()
                if not coords_raw or (system != 'cartesian' and coords_raw == 'x, y, z'):
                    coords_raw = default_coords_map.get(system, 'x, y, z')
                c_syms = _syms(coords_raw)
                while len(c_syms) < 3:
                    c_syms.append(sp.Symbol('z'))
                if op in ('curv_grad', 'vec_grad'):
                    result_obj = _curv_grad(expr, system, c_syms)
                    sympy_code_shown = f"grad({pc(expr)}, system='{system}', coords={pc(c_syms)})"
                elif op in ('curv_laplacian', 'vec_laplacian'):
                    result_obj = _curv_laplacian(expr, system, c_syms)
                    sympy_code_shown = f"laplacian({pc(expr)}, system='{system}', coords={pc(c_syms)})"
                elif op in ('curv_div', 'vec_div'):
                    if not isinstance(expr, sp.MatrixBase):
                        expr = sp.Matrix(expr)
                    result_obj = _curv_div(expr, system, c_syms)
                    sympy_code_shown = f"div({pc(expr)}, system='{system}', coords={pc(c_syms)})"
                elif op in ('curv_curl', 'vec_curl'):
                    if not isinstance(expr, sp.MatrixBase):
                        expr = sp.Matrix(expr)
                    result_obj = _curv_curl(expr, system, c_syms)
                    sympy_code_shown = f"curl({pc(expr)}, system='{system}', coords={pc(c_syms)})"

            elif op == 'mech_strain':
                coords_raw = params.get('coords', 'x, y, z')
                c_syms = _syms(coords_raw)
                result_obj = _mech_strain(expr, c_syms)
                sympy_code_shown = f"mech_strain({pc(expr)}, coords={pc(c_syms)})"

            elif op == 'mech_compat':
                coords_raw = params.get('coords', 'x, y, z')
                c_syms = _syms(coords_raw)
                compat_res = _mech_compat(expr, c_syms)
                if compat_res['dim'] == 2:
                    if compat_res['satisfied']:
                        custom_latex = r"\begin{aligned} &\text{\textbf{Saint-Venant Compatibility (2D):}} \\ &\nabla \times (\nabla \times \boldsymbol{\varepsilon})^T = 0 \quad \text{\textcolor{#059669}{\textbf{\checkmark Identically Satisfied}}} \\ &\text{Continuous single-valued displacement field } \vec{u}(x,y) \text{ guaranteed.} \end{aligned}"
                        result_obj = sp.Integer(0)
                    else:
                        custom_latex = r"\begin{aligned} &\text{\textbf{Saint-Venant Compatibility (2D) Residual:}} \\ &R = \frac{\partial^2 \varepsilon_{xx}}{\partial y^2} + \frac{\partial^2 \varepsilon_{yy}}{\partial x^2} - 2\frac{\partial^2 \varepsilon_{xy}}{\partial x \partial y} = " + sp.latex(compat_res['residual']) + r" \neq 0 \end{aligned}"
                        result_obj = compat_res['residual']
                else:
                    if compat_res['satisfied']:
                        custom_latex = r"\begin{aligned} &\text{\textbf{Saint-Venant Compatibility (3D):}} \\ &\text{All 6 compatibility conditions } S_{ij} = 0 \quad \text{\textcolor{#059669}{\textbf{\checkmark Identically Satisfied}}} \end{aligned}"
                        result_obj = sp.zeros(3, 3)
                    else:
                        pieces = [f"S_{{ij}}^{{{k+1}}} = {sp.latex(r)}" for k, r in enumerate(compat_res['residuals']) if r != 0]
                        custom_latex = r"\begin{aligned} &\text{\textbf{Compatibility Non-Zero Residuals:}} \\ &" + r" \\ &".join(pieces) + r" \end{aligned}"
                        result_obj = sp.Matrix(compat_res['residuals'])
                out_history[cell_index] = result_obj
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"mech_compat({pc(expr)})",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op == 'mech_hooke':
                st = params.get('state', 'plane_stress')
                dr = params.get('direction', 'strain_to_stress')
                E_sym = _sym(params.get('E'), 'E')
                nu_sym = _sym(params.get('nu'), 'nu')
                result_obj = _mech_hooke(expr, st, dr, E_sym, nu_sym)
                sympy_code_shown = f"mech_hooke({pc(expr)}, state='{st}', direction='{dr}', E={pc(E_sym)}, nu={pc(nu_sym)})"

            elif op == 'mech_invariants':
                inv_res = _mech_invariants(expr)
                sig_ltx = sp.latex(inv_res['sigma'])
                S_ltx = sp.latex(inv_res['S'])
                I1_ltx = sp.latex(inv_res['I1'])
                I2_ltx = sp.latex(inv_res['I2'])
                I3_ltx = sp.latex(inv_res['I3'])
                J2_ltx = sp.latex(inv_res['J2'])
                vm_ltx = sp.latex(inv_res['sigma_vm'])
                custom_latex = (
                    r"\begin{aligned} "
                    r"&\text{\textbf{Stress Invariants \& von Mises Yield:}} \\ "
                    r"&I_1 = \mathrm{tr}(\boldsymbol{\sigma}) = " + I1_ltx + r", \quad "
                    r"I_2 = " + I2_ltx + r", \quad "
                    r"I_3 = \det(\boldsymbol{\sigma}) = " + I3_ltx + r" \\ "
                    r"&\mathbf{S} = \boldsymbol{\sigma} - \frac{I_1}{3}\mathbf{I} = " + S_ltx + r" \\ "
                    r"&J_2 = \frac{1}{2}\mathrm{tr}(\mathbf{S}^2) = " + J2_ltx + r" \\ "
                    r"&\sigma_{\mathrm{vm}} = \sqrt{3 J_2} = " + vm_ltx + r" "
                    r"\end{aligned}"
                )
                result_obj = inv_res['sigma_vm']
                out_history[cell_index] = result_obj
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': sp.latex(sp.N(result_obj, 8)) if hasattr(result_obj, 'evalf') else None,
                    'sympyCode': f"mech_invariants({pc(expr)})",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op == 'mech_airy':
                coords_raw = params.get('coords', 'x, y')
                c_syms = _syms(coords_raw)
                airy_res = _mech_airy(expr, c_syms)
                sig_mat = airy_res['stress_matrix']
                bih_ltx = sp.latex(airy_res['biharmonic'])
                is_bih = airy_res['is_biharmonic']
                status_ltx = r"\text{\textcolor{#059669}{\textbf{\checkmark Biharmonic Valid (\nabla^4\Phi = 0)}}}" if is_bih else r"\text{\textcolor{#DC2626}{\textbf{\times Not Biharmonic (\nabla^4\Phi \neq 0)}}}"
                custom_latex = (
                    r"\begin{aligned} "
                    r"&\text{\textbf{Airy Stress Function Analyzer:}} \quad " + status_ltx + r" \\ "
                    r"&\nabla^4\Phi = " + bih_ltx + r" \\ "
                    r"&\boldsymbol{\sigma} = \begin{bmatrix} \frac{\partial^2\Phi}{\partial y^2} & -\frac{\partial^2\Phi}{\partial x \partial y} \\ -\frac{\partial^2\Phi}{\partial x \partial y} & \frac{\partial^2\Phi}{\partial x^2} \end{bmatrix} = " + sp.latex(sig_mat) + r" "
                    r"\end{aligned}"
                )
                result_obj = sig_mat
                out_history[cell_index] = result_obj
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"mech_airy({pc(expr)}, coords={pc(c_syms)})",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op == 'mech_mohr':
                mohr_res = _mech_mohr(expr)
                s_avg, R = mohr_res['sig_avg'], mohr_res['R']
                s1, s2 = mohr_res['sig_1'], mohr_res['sig_2']
                t_max = mohr_res['tau_max']
                th_p = mohr_res['theta_p']
                custom_latex = (
                    r"\begin{aligned} "
                    r"&\text{\textbf{Mohr's Circle Analysis:}} \\ "
                    r"&\sigma_{\text{avg}} = \frac{\sigma_x + \sigma_y}{2} = " + sp.latex(s_avg) + r", \quad "
                    r"R = \sqrt{\left(\frac{\sigma_x - \sigma_y}{2}\right)^2 + \tau_{xy}^2} = " + sp.latex(R) + r" \\ "
                    r"&\sigma_1 = \sigma_{\text{avg}} + R = " + sp.latex(s1) + r", \quad "
                    r"\sigma_2 = \sigma_{\text{avg}} - R = " + sp.latex(s2) + r" \\ "
                    r"&\tau_{\max} = R = " + sp.latex(t_max) + r", \quad "
                    r"\theta_p = \frac{1}{2}\operatorname{atan2}(2\tau_{xy}, \sigma_x - \sigma_y) = " + sp.latex(th_p) + r" "
                    r"\end{aligned}"
                )
                result_obj = sp.Matrix([s1, s2, t_max])
                out_history[cell_index] = result_obj

                mohr_plot = None
                try:
                    s_x_f = float(sp.N(mohr_res['sig_x']))
                    s_y_f = float(sp.N(mohr_res['sig_y']))
                    t_xy_f = float(sp.N(mohr_res['tau_xy']))
                    c_f = 0.5 * (s_x_f + s_y_f)
                    r_f = math.sqrt((0.5 * (s_x_f - s_y_f))**2 + t_xy_f**2)
                    s1_f = c_f + r_f
                    s2_f = c_f - r_f
                    th_pts = [2 * math.pi * i / 200 for i in range(201)]
                    mohr_plot = {
                        'type': 'parametric',
                        'traces': [
                            {
                                'x': [c_f + r_f * math.cos(t) for t in th_pts],
                                'y': [r_f * math.sin(t) for t in th_pts],
                                'mode': 'lines',
                                'line': {'color': '#EA580C', 'width': 2.5},
                                'name': "Mohr's Circle"
                            },
                            {
                                'x': [s_x_f, s_y_f],
                                'y': [-t_xy_f, t_xy_f],
                                'mode': 'lines+markers',
                                'line': {'color': '#3F3F46', 'width': 1.5, 'dash': 'dot'},
                                'marker': {'size': 8, 'color': '#3F3F46'},
                                'name': f"Stress State (σx={s_x_f:.2f}, σy={s_y_f:.2f})"
                            },
                            {
                                'x': [s1_f, s2_f],
                                'y': [0.0, 0.0],
                                'mode': 'markers',
                                'marker': {'size': 9, 'color': '#059669', 'symbol': 'diamond'},
                                'name': f"Principal Stresses (σ₁={s1_f:.2f}, σ₂={s2_f:.2f})"
                            },
                            {
                                'x': [c_f, c_f],
                                'y': [r_f, -r_f],
                                'mode': 'markers',
                                'marker': {'size': 8, 'color': '#2563EB', 'symbol': 'circle'},
                                'name': f"Max Shear τ_max=±{r_f:.2f}"
                            }
                        ],
                        'title': f"Mohr's Circle: σ₁={s1_f:.2f}, σ₂={s2_f:.2f}, τ_max={r_f:.2f}",
                        'xlab': 'Normal Stress σ_n',
                        'ylab': 'Shear Stress τ'
                    }
                except Exception:
                    mohr_plot = None

                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"mech_mohr({pc(expr)})",
                    'assigned': None,
                    'plotData': mohr_plot,
                    'session': serialize_session()
                })

            elif op == 'em_maxwell_check':
                coords_raw = params.get('coords', 'x, y, z')
                c_syms = _syms(coords_raw)
                t_sym = _sym(params.get('time'), 't')
                rho_e, _ = parse_math_input(str(params.get('rho', '0')), latest_idx)
                J_raw = str(params.get('J', '[0, 0, 0]'))
                J_e, _ = parse_math_input(J_raw, latest_idx)
                if not isinstance(J_e, sp.MatrixBase):
                    J_e = sp.Matrix(J_e) if isinstance(J_e, (list, tuple)) else sp.Matrix([0, 0, 0])
                chk = _em_maxwell_check(expr, c_syms, t_sym, rho_e, J_e)
                def _badge(ok): return r"\text{\textcolor{#059669}{\textbf{\checkmark Satisfied (0)}}}" if ok else r"\text{\textcolor{#DC2626}{\textbf{\times Non-Zero}}}"
                custom_latex = (
                    r"\begin{aligned} "
                    r"&\text{\textbf{Maxwell's Differential Equations Check:}} \\ "
                    r"&\text{1. Gauss } (\nabla\cdot\mathbf{E} - \rho/\varepsilon_0): \quad " + _badge(chk['gauss_E']['ok']) + r" \quad \text{Res} = " + sp.latex(chk['gauss_E']['res']) + r" \\ "
                    r"&\text{2. Gauss Magnetism } (\nabla\cdot\mathbf{B}): \quad " + _badge(chk['gauss_B']['ok']) + r" \quad \text{Res} = " + sp.latex(chk['gauss_B']['res']) + r" \\ "
                    r"&\text{3. Faraday } (\nabla\times\mathbf{E} + \partial_t\mathbf{B}): \quad " + _badge(chk['faraday']['ok']) + r" \quad \text{Res} = " + sp.latex(chk['faraday']['res']) + r" \\ "
                    r"&\text{4. Ampère-Maxwell } (\nabla\times\mathbf{B} - \mu_0\varepsilon_0\partial_t\mathbf{E} - \mu_0\mathbf{J}): \quad " + _badge(chk['ampere']['ok']) + r" \quad \text{Res} = " + sp.latex(chk['ampere']['res']) + r" "
                    r"\end{aligned}"
                )
                result_obj = sp.Matrix([chk['gauss_E']['res'], chk['gauss_B']['res']])
                out_history[cell_index] = result_obj
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"em_maxwell_check({pc(expr)})",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op == 'em_potentials':
                coords_raw = params.get('coords', 'x, y, z')
                c_syms = _syms(coords_raw)
                t_sym = _sym(params.get('time'), 't')
                V_e, _ = parse_math_input(str(params.get('V', '0')), latest_idx)
                pots = _em_potentials(expr, V_e, c_syms, t_sym)
                E_f, B_f = pots['E'], pots['B']
                custom_latex = (
                    r"\begin{aligned} "
                    r"&\text{\textbf{Electromagnetic Fields from Potentials:}} \\ "
                    r"&\mathbf{B} = \nabla \times \mathbf{A} = " + sp.latex(B_f) + r" \\ "
                    r"&\mathbf{E} = -\nabla V - \frac{\partial\mathbf{A}}{\partial t} = " + sp.latex(E_f) + r" "
                    r"\end{aligned}"
                )
                result_obj = sp.Matrix([E_f.T, B_f.T]).T
                out_history[cell_index] = result_obj
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"em_potentials(A={pc(expr)}, V={pc(V_e)})",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op == 'em_gauge':
                coords_raw = params.get('coords', 'x, y, z')
                c_syms = _syms(coords_raw)
                t_sym = _sym(params.get('time'), 't')
                c_speed = _sym(params.get('c'), 'c')
                V_e, _ = parse_math_input(str(params.get('V', '0')), latest_idx)
                g_res = _em_gauge(expr, V_e, c_syms, t_sym, c_speed)
                l_badge = r"\text{\textcolor{#059669}{\textbf{\checkmark Satisfied (0)}}}" if g_res['lorenz_ok'] else r"\text{\textcolor{#DC2626}{\textbf{\times Non-Zero}}}"
                c_badge = r"\text{\textcolor{#059669}{\textbf{\checkmark Satisfied (0)}}}" if g_res['coulomb_ok'] else r"\text{\textcolor{#DC2626}{\textbf{\times Non-Zero}}}"
                custom_latex = (
                    r"\begin{aligned} "
                    r"&\text{\textbf{Gauge Invariance Condition Verifier:}} \\ "
                    r"&\text{Lorenz Gauge } (\nabla\cdot\mathbf{A} + \frac{1}{c^2}\partial_t V): \quad " + l_badge + r" \quad \text{Res} = " + sp.latex(g_res['lorenz_res']) + r" \\ "
                    r"&\text{Coulomb Gauge } (\nabla\cdot\mathbf{A}): \quad " + c_badge + r" \quad \text{Res} = " + sp.latex(g_res['coulomb_res']) + r" "
                    r"\end{aligned}"
                )
                result_obj = g_res['lorenz_res']
                out_history[cell_index] = result_obj
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"em_gauge(A={pc(expr)}, V={pc(V_e)})",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op == 'em_poynting':
                poynt = _em_poynting(expr)
                S_f, u_f, g_f = poynt['S'], poynt['u'], poynt['g']
                custom_latex = (
                    r"\begin{aligned} "
                    r"&\text{\textbf{Poynting Energy Flux \& Density:}} \\ "
                    r"&\mathbf{S} = \frac{1}{\mu_0}(\mathbf{E} \times \mathbf{B}) = " + sp.latex(S_f) + r" \\ "
                    r"&u = \frac{1}{2}\varepsilon_0|\mathbf{E}|^2 + \frac{1}{2\mu_0}|\mathbf{B}|^2 = " + sp.latex(u_f) + r" \\ "
                    r"&\mathbf{g} = \mu_0\varepsilon_0\mathbf{S} = \frac{\mathbf{S}}{c^2} = " + sp.latex(g_f) + r" "
                    r"\end{aligned}"
                )
                result_obj = S_f
                out_history[cell_index] = result_obj
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"em_poynting({pc(expr)})",
                    'assigned': None,
                    'session': serialize_session()
                })

            elif op == 'em_stress_tensor':
                coords_raw = params.get('coords', 'x, y, z')
                c_syms = _syms(coords_raw)
                st_res = _em_stress_tensor(expr, c_syms)
                T_mat = st_res['T']
                f_vec = st_res['f']
                custom_latex = (
                    r"\begin{aligned} "
                    r"&\text{\textbf{Maxwell Stress Tensor } T_{ij} \text{ \& Force Density:}} \\ "
                    r"&\mathbf{T} = " + sp.latex(T_mat) + r" \\ "
                    r"&\mathbf{f}_{\text{EM}} = \nabla \cdot \mathbf{T} = " + sp.latex(f_vec) + r" "
                    r"\end{aligned}"
                )
                result_obj = T_mat
                out_history[cell_index] = result_obj
                return json.dumps({
                    'status': 'ok',
                    'latex': custom_latex,
                    'approxLatex': None,
                    'sympyCode': f"em_stress_tensor({pc(expr)})",
                    'assigned': None,
                    'session': serialize_session()
                })

        # Save result into Out[n] history (for an assignment, %n recalls the assigned value)
        out_history[cell_index] = result_obj if history_value is None else history_value

        # Handle explicit "Assign to Variable" box
        if assign_to:
            valid_var = re.sub(r'[^a-zA-Z0-9_]', '', assign_to)
            if valid_var:
                session_vars[valid_var] = result_obj
                assigned_name = valid_var
                code_lines = sympy_code_shown.split('\n')
                code_lines[-1] = f"{valid_var} = {code_lines[-1]}"
                sympy_code_shown = '\n'.join(code_lines)

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
            'message': _friendly_error(exc)
        })
