/* Park & Fly Mockup – eigenständige Runtime (kein Build, keine Abhängigkeiten) */
(function () {
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(patch) {
      Object.assign(this.state, typeof patch === 'function' ? patch(this.state) : patch);
      if (this.__rerender) this.__rerender();
    }
    renderVals() { return {}; }
  }
  window.DCLogic = DCLogic;
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}';
  (document.head || document.documentElement).appendChild(hide);

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var SINGLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;

  function resolve(expr, scope) {
    expr = expr.trim();
    if (expr === 'true') return true;
    if (expr === 'false') return false;
    if (expr === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    var parts = expr.split('.');
    var v = scope;
    for (var i = 0; i < parts.length; i++) {
      if (v == null) return undefined;
      v = v[parts[i]];
    }
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, e) { var v = resolve(e, scope); return v == null ? '' : String(v); });
  }

  function render(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName;
    if (tag === 'sc-for') {
      var list = resolve((node.getAttribute('list') || '').replace(SINGLE, '$1'), scope) || [];
      var as = node.getAttribute('as') || 'item';
      list.forEach(function (item, idx) {
        var s = Object.create(scope); s[as] = item; s.$index = idx;
        node.childNodes.forEach(function (c) { render(c, s, out); });
      });
      return;
    }
    if (tag === 'sc-if') {
      var val = resolve((node.getAttribute('value') || '').replace(SINGLE, '$1'), scope);
      if (val) node.childNodes.forEach(function (c) { render(c, scope, out); });
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.localName)
      : document.createElement(node.localName);
    Array.prototype.forEach.call(node.attributes, function (a) {
      var name = a.name, value = a.value;
      if (name.indexOf('hint-') === 0) return;
      var m = value.match(SINGLE);
      if (name.slice(0, 2) === 'on' && m) {
        var fn = resolve(m[1], scope);
        if (typeof fn === 'function') el.addEventListener(name.slice(2).toLowerCase(), function (ev) { fn(ev); });
        return;
      }
      if (m) {
        var raw = resolve(m[1], scope);
        if (name === 'checked' || name === 'disabled' || name === 'selected') {
          if (raw) el.setAttribute(name, ''); if (name === 'checked') el.checked = !!raw;
          return;
        }
        if (raw === false || raw == null) return;
        el.setAttribute(name, String(raw));
        return;
      }
      el.setAttribute(name, value.indexOf('{{') >= 0 ? interp(value, scope) : value);
    });
    var kids = [];
    node.childNodes.forEach(function (c) { render(c, scope, kids); });
    kids.forEach(function (k) { el.appendChild(k); });
    out.push(el);
  }

  function fit(mount) {
    var root = mount.firstElementChild;
    if (!root) return;
    var w = root.offsetWidth || parseInt(root.style.width, 10) || 0;
    var avail = document.documentElement.clientWidth;
    mount.style.zoom = w && avail < w ? String(avail / w) : '';
  }

  function boot() {
    if (!document.querySelector('meta[name="viewport"]')) {
      var mv = document.createElement('meta');
      mv.name = 'viewport'; mv.content = 'width=device-width, initial-scale=1';
      document.head.appendChild(mv);
    }
    var tpl = document.querySelector('x-dc');
    if (!tpl) return;
    var helmet = tpl.querySelector('helmet');
    if (helmet) { while (helmet.firstChild) document.head.appendChild(helmet.firstChild); helmet.remove(); }
    var extra = document.createElement('style');
    extra.textContent = 'body{display:flex;justify-content:center;min-height:100vh}#dc-mount{flex-shrink:0}';
    document.head.appendChild(extra);

    var script = document.querySelector('script[type="text/x-dc"]');
    var Comp = DCLogic;
    if (script) {
      try { Comp = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic); }
      catch (e) { console.error('Mockup-Logik konnte nicht geladen werden', e); }
    }
    var inst = new Comp({});
    var mount = document.createElement('div');
    mount.id = 'dc-mount';
    tpl.parentNode.insertBefore(mount, tpl);
    tpl.remove();

    function draw() {
      var scrolls = Array.prototype.map.call(mount.querySelectorAll('*'), function (n) { return n.scrollTop; });
      var vals = inst.renderVals() || {};
      var out = [];
      tpl.childNodes.forEach(function (c) { render(c, vals, out); });
      mount.textContent = '';
      out.forEach(function (n) { mount.appendChild(n); });
      Array.prototype.forEach.call(mount.querySelectorAll('*'), function (n, i) { if (scrolls[i]) n.scrollTop = scrolls[i]; });
      fit(mount);
    }
    inst.__rerender = draw;
    draw();
    window.addEventListener('resize', function () { fit(mount); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
