const test = require("node:test");
const assert = require("node:assert/strict");
const { interpretarTrama, ultimaLectura } = require("../src/balanzaParser");

test("CAS estable e inestable", () => {
  assert.deepEqual(
    { ...interpretarTrama("ST,GS,+  1.234kg"), crudo: undefined },
    { peso: 1.234, unidad: "kg", estable: true, crudo: undefined }
  );
  assert.equal(interpretarTrama("US,GS,+  1.230kg").estable, false);
});

test("Torrey / genérica sin unidad se toma en kg", () => {
  assert.equal(interpretarTrama("   0.485 kg").peso, 0.485);
  assert.equal(interpretarTrama("2.5").peso, 2.5);
});

test("Mettler Toledo 8217 con STX y en gramos/libras", () => {
  assert.equal(interpretarTrama("\x0201.234").peso, 1.234);
  assert.equal(interpretarTrama("1250 g").peso, 1.25);
  assert.equal(interpretarTrama("2.00 lb").peso, 0.907);
});

test("coma decimal, negativo y sobrecarga no son estables", () => {
  assert.equal(interpretarTrama("1,5 kg").peso, 1.5);
  assert.equal(interpretarTrama("-0.010 kg").estable, false);
  assert.equal(interpretarTrama("OL,GS,+ 99.999kg").estable, false);
  assert.equal(interpretarTrama("   "), null);
  assert.equal(interpretarTrama("ERROR"), null);
});

test("modo continuo: la última lectura estable gana", () => {
  const flujo = "US,GS,+  0.900kg\r\nST,GS,+  1.000kg\r\nUS,GS,+  1.100kg\r\n";
  assert.equal(ultimaLectura(flujo).peso, 1.0);
  assert.equal(ultimaLectura("US,GS,+  0.900kg\r\n").estable, false);
});
