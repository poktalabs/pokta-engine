function compact(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeKey(value: string | null | undefined): string {
  return compact(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const vendorAliases = new Map<string, string>([
  ['nuur', 'NUUR'],
  ['mabe', 'MABE'],
  ['colchones canada', 'COLCHONES CANADA'],
]);

const productTypeAliases = new Map<string, string>([
  ['audio', 'Audio'],
  ['audifonos', 'Audio'],
  ['celular', 'Celulares'],
  ['celulares', 'Celulares'],
  ['pantalla', 'Pantallas'],
  ['pantallas', 'Pantallas'],
  ['television', 'Pantallas'],
  ['televisión', 'Pantallas'],
  ['televisiones', 'Pantallas'],
  ['tv', 'Pantallas'],
  ['campana', 'Campana'],
  ['campanas', 'Campana'],
  ['fragancia', 'Fragancia'],
  ['fragancias', 'Fragancia'],
  ['perfume', 'Fragancia'],
  ['perfumes', 'Fragancia'],
  ['microondas', 'Microondas'],
  ['computacion', 'Computacion'],
  ['computación', 'Computacion'],
  ['lavadora', 'Lavadora'],
  ['lavadoras', 'Lavadora'],
  ['centro de lavado', 'Lavadora'],
  ['colchon', 'Descanso/Colchon'],
  ['colchones', 'Descanso/Colchon'],
  ['descanso', 'Descanso/Colchon'],
  ['base de colchon', 'Descanso/Colchon'],
  ['moto', 'MOTO'],
  ['motos', 'MOTO'],
  ['aire acondicionado', 'Aire Acondicionado'],
  ['asador', 'Asador'],
  ['asadores', 'Asador'],
  ['bide', 'Bidet'],
  ['bidet', 'Bidet'],
  ['bidets', 'Bidet'],
  ['cafetera', 'Cafetera'],
  ['cafeteras', 'Cafetera'],
  ['limpieza', 'Limpieza'],
  ['calentador', 'Calentador'],
  ['calentadores', 'Calentador'],
  ['cerradura', 'Cerradura'],
  ['cerraduras', 'Cerradura'],
  ['electrodomesticos', 'Electrodomesticos'],
  ['electrodomésticos', 'Electrodomesticos'],
  ['estufa', 'Estufas'],
  ['estufas', 'Estufas'],
  ['extractor de jugos', 'Extractor Jugos'],
  ['freidora', 'Freidora'],
  ['licuadora', 'Licuadora'],
  ['licuadoras', 'Licuadora'],
  ['ollas', 'Ollas'],
  ['maquina de hielo', 'Maquina Hielo'],
  ['máquina de hielo', 'Maquina Hielo'],
  ['hielera', 'Maquina Hielo'],
  ['refrigerador', 'Refrigerador'],
  ['refrigeradores', 'Refrigerador'],
  ['enfriador', 'Refrigerador'],
  ['enfriador de bebidas', 'Refrigerador'],
  ['frigobar', 'Frigobar'],
  ['frigobares', 'Frigobar'],
  ['lavavajillas', 'Lavavajillas'],
  ['bicicleta', 'Bicicleta'],
]);

export function normalizeShopifyVendor(value: string | null | undefined): string {
  const raw = compact(value);
  if (!raw) return '';

  return vendorAliases.get(normalizeKey(raw)) ?? raw;
}

export function normalizeShopifyProductType(value: string | null | undefined): string {
  const raw = compact(value);
  if (!raw) return '';

  return productTypeAliases.get(normalizeKey(raw)) ?? raw;
}
