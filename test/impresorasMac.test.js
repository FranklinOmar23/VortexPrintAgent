const test = require("node:test");
const assert = require("node:assert/strict");
const { interpretarLpstat } = require("../src/impresorasMac");

const LPSTAT_P = [
  "printer EPSON_TM_T20III is idle.  enabled since Thu Oct 23 10:00:00 2026",
  "printer Oficina disabled since Thu Oct 23 09:00:00 2026 -",
  "\treason unknown",
  "printer Cocina now printing Cocina-12.  enabled since Thu Oct 23 10:05:00 2026",
].join("\n");

test("lista las colas de CUPS con la predeterminada y las deshabilitadas", () => {
  const impresoras = interpretarLpstat(LPSTAT_P, "system default destination: EPSON_TM_T20III\n");

  assert.deepEqual(impresoras, [
    { name: "EPSON_TM_T20III", isDefault: true, isOffline: false, isLocal: true },
    { name: "Oficina", isDefault: false, isOffline: true, isLocal: true },
    { name: "Cocina", isDefault: false, isOffline: false, isLocal: true },
  ]);
});

test("sin impresoras o sin predeterminada no falla", () => {
  assert.deepEqual(interpretarLpstat("", "no system default destination\n"), []);
  assert.equal(interpretarLpstat("printer Caja is idle.", "").at(0).isDefault, false);
});
