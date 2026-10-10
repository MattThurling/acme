// In-chat UI for Acme's MCP tools, built on the MCP Apps extension
// (@modelcontextprotocol/ext-apps). One HTML resource serves all three tools;
// it decides what to render from `structuredContent.kind` in the tool result:
//   products        -> product cards with a "Get finance" action
//   product         -> a single product card
//   finance_result  -> success (reference + "check your inbox") or errors
// "Get finance" opens the finance form in place; Confirm calls the server's
// `request_finance` tool through the host, which may ask the user to approve.
//
// Compliance: every customer-facing finance sentence shown here comes from
// Medifinance's own `message` in the tool result. Nothing about rates,
// payments or approval is ever generated in this file.
import { App } from "@modelcontextprotocol/ext-apps";

const COMPANY_TYPES = {
  limited_company: "Limited company",
  sole_trader: "Sole trader",
  partnership: "Partnership",
};

const app = new App({ name: "Acme Ltd Store", version: "1.0.0" });
const root = document.getElementById("root");

const state = {
  view: "loading",
  products: [],
  selected: null,
  form: { first_name: "", last_name: "", email: "", company_type: "" },
  result: null,
  errors: [],
  busy: false,
};

const gbp = (n) => "£" + Number(n).toLocaleString("en-GB");

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

function brand() {
  return h("div", { class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "A"), "Acme Ltd", h("small", {}, "Dental equipment"));
}

function productCard(p) {
  return h("article", { class: "product", "aria-label": p.name },
    h("h2", {}, p.name),
    h("p", {}, p.description),
    h("div", { class: "price" }, p.price_display || gbp(p.price)),
    h("button", {
      type: "button", class: "btn btn-primary",
      "aria-label": `Get finance for ${p.name} (${p.price_display || gbp(p.price)})`,
      onclick: () => { state.selected = p; state.errors = []; state.view = "form"; render(); },
    }, "Get finance"),
  );
}

function fieldError(name) {
  const e = state.errors.find((x) => x.field === name);
  return e ? h("div", { class: "field-error", id: `err-${name}` }, e.message) : null;
}

function input(name, label, attrs) {
  const err = state.errors.find((x) => x.field === name);
  return h("label", { for: `f-${name}` }, label,
    h("input", {
      id: `f-${name}`, name, value: state.form[name], required: true,
      "aria-invalid": err ? "true" : null, "aria-describedby": err ? `err-${name}` : null,
      oninput: (e) => { state.form[name] = e.target.value; },
      ...attrs,
    }),
    fieldError(name),
  );
}

function financeForm() {
  const p = state.selected;
  const general = state.errors.filter((e) => !e.field || !(e.field in state.form) && e.field !== "company_type");
  const select = h("select", {
    id: "f-company_type", name: "company_type", required: true,
    onchange: (e) => { state.form.company_type = e.target.value; },
  }, h("option", { value: "", disabled: true, selected: !state.form.company_type }, "Select…"),
    ...Object.entries(COMPANY_TYPES).map(([v, l]) => h("option", { value: v, selected: state.form.company_type === v }, l)));

  const form = h("form", {
    class: "panel", "aria-labelledby": "form-title",
    onsubmit: async (e) => { e.preventDefault(); await confirm(); },
  },
    h("h2", { id: "form-title" }, "Apply for finance"),
    h("p", { class: "sub" }, `${p.name} — ${p.price_display || gbp(p.price)}`),
    general.length ? h("div", { class: "error", role: "alert" }, general.map((x) => x.message).join(" ")) : null,
    h("div", { class: "row" },
      input("first_name", "First name", { autocomplete: "given-name", maxlength: 150 }),
      input("last_name", "Last name", { autocomplete: "family-name", maxlength: 150 }),
    ),
    input("email", "Email", { type: "email", autocomplete: "email", maxlength: 254 }),
    h("label", { for: "f-company_type" }, "Company type", select, fieldError("company_type")),
    h("p", { class: "small" }, "Confirming starts a finance application with Medifinance. You'll receive an email with a secure link to complete it — nothing is charged today."),
    h("div", { class: "actions" },
      h("button", { type: "submit", class: "btn btn-primary", disabled: state.busy }, state.busy ? "Submitting…" : "Confirm application"),
      h("button", { type: "button", class: "btn btn-secondary", onclick: () => { state.view = state.products.length > 1 ? "products" : "product"; render(); } }, "Back"),
    ),
  );
  return form;
}

async function confirm() {
  state.busy = true; state.errors = []; render();
  try {
    const result = await app.callServerTool({
      name: "request_finance",
      arguments: { product_id: state.selected.id, ...state.form },
    });
    showResult(result);
  } catch (err) {
    state.errors = [{ field: null, message: `Could not submit: ${err?.message || err}` }];
    state.view = "form";
  } finally {
    state.busy = false; render();
  }
}

function showResult(result) {
  const sc = result?.structuredContent || {};
  if (sc.ok) {
    state.result = sc; state.view = "success";
  } else {
    state.errors = sc.errors || [{ field: null, message: sc.message || textOf(result) || "Something went wrong." }];
    if (sc.product && !state.selected) state.selected = sc.product;
    if (sc.applicant) state.form = { ...state.form, ...sc.applicant };
    state.view = state.selected ? "form" : "error";
  }
}

function textOf(result) {
  return (result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

function successPanel() {
  const r = state.result;
  return h("div", { class: "panel success", role: "status" },
    h("h2", {}, h("span", { class: "tick", "aria-hidden": "true" }, "✓"), r.deduplicated ? "Application already open" : "Application sent"),
    r.product ? h("p", { class: "sub" }, `${r.product.name} — ${gbp(r.product.price)}`) : null,
    h("p", {}, r.message),
    r.application_reference ? h("p", {}, "Your reference: ", h("span", { class: "ref" }, r.application_reference)) : null,
    h("p", { class: "small" }, "Check your inbox for the secure link from Medifinance to complete the application."),
    r.sandbox ? h("p", { class: "small" }, "Sandbox mode: no real application was created and no email was sent.") : null,
  );
}

function render() {
  root.replaceChildren();
  root.append(brand());
  switch (state.view) {
    case "products":
      root.append(state.products.length
        ? h("div", { class: "grid" }, state.products.map(productCard))
        : h("p", { class: "muted" }, "No matching products."));
      break;
    case "product":
      root.append(h("div", { class: "grid" }, productCard(state.selected)));
      break;
    case "form":
      root.append(financeForm());
      break;
    case "success":
      root.append(successPanel());
      break;
    case "error":
      root.append(h("div", { class: "error", role: "alert" }, state.errors.map((e) => e.message).join(" ")));
      break;
    default:
      root.append(h("p", { class: "muted" }, "Loading…"));
  }
}

function applyTheme(theme) {
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  else document.documentElement.dataset.theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

app.ontoolinput = ({ arguments: args } = {}) => {
  // Prefill the form with whatever the model already knew.
  if (args && typeof args === "object") {
    for (const k of Object.keys(state.form)) if (typeof args[k] === "string") state.form[k] = args[k];
  }
};

app.ontoolresult = (result) => {
  const sc = result?.structuredContent || {};
  if (sc.kind === "products") {
    state.products = sc.products || []; state.view = "products";
  } else if (sc.kind === "product") {
    state.selected = sc.product; state.products = [sc.product]; state.view = "product";
  } else if (sc.kind === "finance_result") {
    showResult(result);
  } else if (result?.isError) {
    state.errors = [{ field: null, message: textOf(result) || "Something went wrong." }]; state.view = "error";
  }
  render();
};

app.onhostcontextchanged = (ctx) => { if (ctx?.theme) applyTheme(ctx.theme); };

app.connect().then(() => {
  applyTheme(app.getHostContext()?.theme);
  try { app.setupSizeChangedNotifications(); } catch { /* optional */ }
}).catch((err) => {
  root.replaceChildren(h("p", { class: "error" }, `Could not connect to the chat host: ${err?.message || err}`));
});

applyTheme();
