(() => {
  // ========= Helpers =========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const IVA_RATE = 0.19;
  const IVA_FACTOR = 1 + IVA_RATE; // 1.19

  const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

  function parseNumberLoose(str) {
    // Acepta "119.000", "119,000", "$ 119000", etc.
    if (str == null) return NaN;
    const s = String(str)
      .trim()
      .replace(/\s+/g, '')
      .replace(/[$]/g, '')
      .replace(/[^\d.,-]/g, '');

    if (!s) return NaN;

    // Si hay tanto coma como punto, asumimos que el último separador es decimal.
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    let normalized = s;

    if (lastComma !== -1 && lastDot !== -1) {
      const decSep = lastComma > lastDot ? ',' : '.';
      const grpSep = decSep === ',' ? '.' : ',';
      normalized = normalized.split(grpSep).join('');
      normalized = normalized.replace(decSep, '.');
    } else if (lastComma !== -1) {
      // Interpretar coma como decimal si aparece una sola vez y hay <=2 decimales al final
      const parts = normalized.split(',');
      if (parts.length === 2 && parts[1].length <= 2) normalized = parts[0].replace(/\./g, '') + '.' + parts[1];
      else normalized = normalized.replace(/,/g, '');
    } else {
      // Solo puntos: pueden ser miles o decimal. Si hay 1 punto y <=2 decimales, decimal; si no, miles.
      const parts = normalized.split('.');
      if (parts.length === 2 && parts[1].length <= 2) normalized = parts[0].replace(/,/g, '') + '.' + parts[1];
      else normalized = normalized.replace(/\./g, '');
      normalized = normalized.replace(/,/g, '');
    }

    const num = Number(normalized);
    return Number.isFinite(num) ? num : NaN;
  }

  function formatMoney(num) {
    if (!Number.isFinite(num)) return '$0';
    return '$' + nf.format(num);
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(String(text));
      toast('Copiado al portapapeles');
    } catch {
      toast('No se pudo copiar (permiso del navegador)');
    }
  }

  async function pasteFromClipboard() {
    try {
      return await navigator.clipboard.readText();
    } catch {
      toast('No se pudo pegar (permiso del navegador)');
      return '';
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#calcMini');
    if (!el) return;
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.textContent = 'Listo'), 1600);
  }

  // ========= IVA =========
  const ivaInput = $('#ivaInput');
  const ivaResult = $('#ivaResult');
  const ivaResultRaw = $('#ivaResultRaw');
  const ivaDiff = $('#ivaDiff');
  const ivaDiffRaw = $('#ivaDiffRaw');
  const ivaResultLabel = $('#ivaResultLabel');

  function ivaMode() {
    return document.querySelector('input[name="ivaMode"]:checked')?.value || 'SIN';
  }

  function computeIVA() {
    const v = parseNumberLoose(ivaInput.value);
    const mode = ivaMode();

    if (!Number.isFinite(v) || v === 0) {
      ivaResult.textContent = '$0';
      ivaResultRaw.textContent = '0';
      ivaDiff.textContent = '$0';
      ivaDiffRaw.textContent = '0';
      ivaResultLabel.textContent = 'Resultado';
      return { ok: false, result: 0, diff: 0, mode };
    }

    let result = 0;
    let diff = 0;

    if (mode === 'SIN') {
      // Valor sin IVA = valor / 1.19
      result = v / IVA_FACTOR;
      diff = v - result; // IVA incluido en el total
      ivaResultLabel.textContent = 'Valor SIN IVA';
    } else {
      // Valor con IVA = valor * 1.19
      result = v * IVA_FACTOR;
      diff = result - v; // IVA agregado
      ivaResultLabel.textContent = 'Valor CON IVA';
    }

    ivaResult.textContent = formatMoney(result);
    ivaResultRaw.textContent = nf.format(result);

    ivaDiff.textContent = formatMoney(diff);
    ivaDiffRaw.textContent = nf.format(diff);

    return { ok: true, result, diff, mode };
  }

  // ========= Calculadora (parser sin eval) =========
  const calcDisplay = $('#calcDisplay');
  const btnCalcClear = $('#btnCalcClear');

  function isOp(c) { return c === '+' || c === '-' || c === '*' || c === '/'; }
  function precedence(op) { return (op === '+' || op === '-') ? 1 : 2; }

  function tokenize(expr) {
    // Soporta números decimales y operadores + - * /
    const s = String(expr).replace(/\s+/g, '');
    if (!s) return [];

    const tokens = [];
    let i = 0;

    while (i < s.length) {
      const ch = s[i];

      // Número (incluye signo unario)
      if (/\d|\./.test(ch) || (ch === '-' && (i === 0 || isOp(s[i - 1])))) {
        let j = i + 1;
        while (j < s.length && /[\d.]/.test(s[j])) j++;
        const numStr = s.slice(i, j);
        if (!/^[-]?\d*\.?\d+$/.test(numStr)) throw new Error('Número inválido');
        tokens.push({ type: 'num', value: Number(numStr) });
        i = j;
        continue;
      }

      if (isOp(ch)) {
        tokens.push({ type: 'op', value: ch });
        i++;
        continue;
      }

      throw new Error('Carácter inválido');
    }

    return tokens;
  }

  function toRPN(tokens) {
    const output = [];
    const ops = [];

    for (const t of tokens) {
      if (t.type === 'num') output.push(t);
      else if (t.type === 'op') {
        while (ops.length && precedence(ops[ops.length - 1].value) >= precedence(t.value)) {
          output.push(ops.pop());
        }
        ops.push(t);
      }
    }

    while (ops.length) output.push(ops.pop());
    return output;
  }

  function evalRPN(rpn) {
    const st = [];
    for (const t of rpn) {
      if (t.type === 'num') st.push(t.value);
      else {
        const b = st.pop();
        const a = st.pop();
        if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Expresión incompleta');

        let res = 0;
        switch (t.value) {
          case '+': res = a + b; break;
          case '-': res = a - b; break;
          case '*': res = a * b; break;
          case '/': res = b === 0 ? NaN : a / b; break;
        }
        st.push(res);
      }
    }
    if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error('Expresión inválida');
    return st[0];
  }

  function evaluateExpression(expr) {
    const tokens = tokenize(expr);
    const rpn = toRPN(tokens);
    return evalRPN(rpn);
  }

  function calcInsert(text) {
    const start = calcDisplay.selectionStart ?? calcDisplay.value.length;
    const end = calcDisplay.selectionEnd ?? calcDisplay.value.length;
    const v = calcDisplay.value;
    calcDisplay.value = v.slice(0, start) + text + v.slice(end);
    calcDisplay.focus();
    const pos = start + text.length;
    calcDisplay.setSelectionRange(pos, pos);
  }

  function calcBackspace() {
    const start = calcDisplay.selectionStart ?? 0;
    const end = calcDisplay.selectionEnd ?? 0;
    const v = calcDisplay.value;

    if (start !== end) {
      calcDisplay.value = v.slice(0, start) + v.slice(end);
      calcDisplay.setSelectionRange(start, start);
      return;
    }
    if (start === 0) return;
    calcDisplay.value = v.slice(0, start - 1) + v.slice(end);
    calcDisplay.setSelectionRange(start - 1, start - 1);
  }

  function calcClear() {
    calcDisplay.value = '';
    toast('Calculadora limpia');
    calcDisplay.focus();
  }

  function calcEvaluate() {
    const expr = calcDisplay.value.trim();
    if (!expr) return;

    try {
      const result = evaluateExpression(expr);
      // Redondeo de presentación: evita notación científica en resultados cotidianos
      const pretty = (Math.abs(result) >= 1e12) ? String(result) : String(Number(result.toFixed(10))).replace(/\.0+$/,'').replace(/(\.\d+?)0+$/,'$1');
      calcDisplay.value = pretty;
      toast('OK');
    } catch (e) {
      toast('Error en la expresión');
    }
  }

  // ========= POS =========
  const posCharge = $('#posCharge');
  const posPaid = $('#posPaid');
  const posChange = $('#posChange');
  const posChangeRaw = $('#posChangeRaw');
  const posStatus = $('#posStatus');
  const posStatusHint = $('#posStatusHint');

  function computePOS() {
    const charge = parseNumberLoose(posCharge.value);
    const paid = parseNumberLoose(posPaid.value);

    if (!Number.isFinite(charge) || !Number.isFinite(paid)) {
      posChange.textContent = '$0';
      posChangeRaw.textContent = '0';
      posStatus.textContent = '—';
      posStatus.className = 'result-value';
      posStatusHint.textContent = 'Ingresa valores para calcular';
      return { ok: false, change: 0, charge, paid };
    }

    const change = paid - charge;
    posChange.textContent = formatMoney(change);
    posChangeRaw.textContent = nf.format(change);

    if (change > 0) {
      posStatus.textContent = 'Cambio correcto';
      posStatus.className = 'result-value state-ok';
      posStatusHint.textContent = 'Entrega el cambio al cliente';
    } else if (change === 0) {
      posStatus.textContent = 'Pago exacto';
      posStatus.className = 'result-value state-ok';
      posStatusHint.textContent = 'No hay cambio a entregar';
    } else {
      posStatus.textContent = 'Falta dinero';
      posStatus.className = 'result-value state-bad';
      posStatusHint.textContent = `Faltan ${formatMoney(Math.abs(change))}`;
    }

    return { ok: true, change, charge, paid };
  }

  // ========= Wiring / Events =========
  // IVA listeners
  ivaInput.addEventListener('input', computeIVA);
  $$('input[name="ivaMode"]').forEach(r => r.addEventListener('change', computeIVA));

  $('#btnIvaToCalc').addEventListener('click', () => {
    const { ok, result } = computeIVA();
    if (!ok) return toast('Primero calcula un valor de IVA');
    calcDisplay.value = String(Number(result.toFixed(10)));
    toast('Valor IVA enviado a calculadora');
    calcDisplay.focus();
  });

  $('#btnIvaCopy').addEventListener('click', async () => {
    const { ok, result } = computeIVA();
    if (!ok) return toast('No hay resultado para copiar');
    await copyToClipboard(String(result));
  });

  $('#btnIvaPaste').addEventListener('click', async () => {
    const t = await pasteFromClipboard();
    if (t) {
      ivaInput.value = t;
      computeIVA();
      toast('Pegado en IVA');
      ivaInput.focus();
    }
  });

  // Calc buttons
  $$('.key').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.dataset.k;

      if (k === '=') return calcEvaluate();
      if (k === 'back') return calcBackspace();
      if (k === 'clear') return calcClear();
      calcInsert(k);
    });
  });

  btnCalcClear.addEventListener('click', calcClear);

  $('#btnCalcCopy').addEventListener('click', async () => {
    const v = calcDisplay.value.trim();
    if (!v) return toast('No hay nada para copiar');
    await copyToClipboard(v);
  });

  $('#btnCalcUseIva').addEventListener('click', () => {
    const { ok, result } = computeIVA();
    if (!ok) return toast('Primero calcula un valor de IVA');
    calcDisplay.value = String(Number(result.toFixed(10)));
    toast('Valor IVA aplicado');
    calcDisplay.focus();
  });

  // Calc keyboard support
  document.addEventListener('keydown', (e) => {
    // Atajo global: Ctrl+L limpiar todo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
      e.preventDefault();
      resetAll();
      return;
    }

    // Si el foco está en inputs de IVA/POS, no interferir salvo Enter para evaluar en calc cuando foco está en calc
    const activeId = document.activeElement?.id;

    // Teclado calculadora: solo si foco está en display (o si el usuario está “en modo calculadora”)
    const inCalc = activeId === 'calcDisplay';

    if (!inCalc) return;

    if (e.key === 'Enter') { e.preventDefault(); calcEvaluate(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); calcBackspace(); return; }
    if (e.key === 'Escape') { e.preventDefault(); calcClear(); return; }

    // Números y operadores
    const allowed = '0123456789.+-*/';
    if (allowed.includes(e.key)) {
      e.preventDefault();
      calcInsert(e.key);
      return;
    }
  });

  // POS listeners
  posCharge.addEventListener('input', computePOS);
  posPaid.addEventListener('input', computePOS);

  $('#btnPosChargeFromCalc').addEventListener('click', () => {
    const v = parseNumberLoose(calcDisplay.value);
    if (!Number.isFinite(v)) return toast('La calculadora no tiene un número válido');
    posCharge.value = String(v);
    computePOS();
    toast('Cobro actualizado desde calculadora');
    posCharge.focus();
  });

  $('#btnPosPaidFromCalc').addEventListener('click', () => {
    const v = parseNumberLoose(calcDisplay.value);
    if (!Number.isFinite(v)) return toast('La calculadora no tiene un número válido');
    posPaid.value = String(v);
    computePOS();
    toast('Pago actualizado desde calculadora');
    posPaid.focus();
  });

  $('#btnPosCopy').addEventListener('click', async () => {
    const { ok, change } = computePOS();
    if (!ok) return toast('No hay cambio calculado');
    await copyToClipboard(String(change));
  });

  $('#btnPosClear').addEventListener('click', () => {
    posCharge.value = '';
    posPaid.value = '';
    computePOS();
    toast('POS limpio');
    posCharge.focus();
  });

  // Reset all
  function resetAll() {
    ivaInput.value = '';
    document.querySelector('input[name="ivaMode"][value="SIN"]').checked = true;
    computeIVA();

    calcDisplay.value = '';
    toast('Todo limpio');

    posCharge.value = '';
    posPaid.value = '';
    computePOS();
  }

  $('#btnResetAll').addEventListener('click', resetAll);

  // Init
  computeIVA();
  computePOS();
})();
