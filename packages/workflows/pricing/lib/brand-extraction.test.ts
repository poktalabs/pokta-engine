import { describe, expect, it } from 'vitest';
import { extractMarcaEmpresaFromTitle } from './brand-extraction.js';

describe('extractMarcaEmpresaFromTitle', () => {
  it('extracts Apple from iPhone titles', () => {
    expect(extractMarcaEmpresaFromTitle({
      title: 'IPHONE 15 PRO MAX RFB 5G ESIM 256GB',
      sku: 'IPHONE-15-PRO-MAX-256',
      product_type: 'Celulares',
    })).toMatchObject({
      marca_empresa: 'Apple',
      marca_empresa_confianza: 'high',
      marca_empresa_source: 'title_rule',
    });
  });

  it('extracts phone brands from controlled title rules', () => {
    expect(extractMarcaEmpresaFromTitle({ title: 'Samsung Galaxy A16 5G' }).marca_empresa).toBe('Samsung');
    expect(extractMarcaEmpresaFromTitle({ title: 'Motorola Moto G35 5G' }).marca_empresa).toBe('Motorola');
    expect(extractMarcaEmpresaFromTitle({ title: 'Infinix HOT 50 PRO 4G' }).marca_empresa).toBe('Infinix');
    expect(extractMarcaEmpresaFromTitle({ title: 'HONOR 70 5G 8/256GB' }).marca_empresa).toBe('Honor');
    expect(extractMarcaEmpresaFromTitle({ title: 'A16 5G' }).marca_empresa).toBe('Samsung');
    expect(extractMarcaEmpresaFromTitle({ title: 'G35 5G' }).marca_empresa).toBe('Motorola');
    expect(extractMarcaEmpresaFromTitle({ title: 'CAMON 40 PRO 4G' }).marca_empresa).toBe('Tecno');
  });

  it('extracts fragrance brands from distributor titles', () => {
    expect(extractMarcaEmpresaFromTitle({ title: 'Calvin Klein Eternity Dama' }).marca_empresa).toBe('Calvin Klein');
    expect(extractMarcaEmpresaFromTitle({ title: 'Coach Wild Rose' }).marca_empresa).toBe('Coach');
    expect(extractMarcaEmpresaFromTitle({ title: 'ARMAF CLUB DE NUIT UNTOLD 105ML EDP SPRAY' }).marca_empresa).toBe('Armaf');
    expect(extractMarcaEmpresaFromTitle({ title: 'LATTAFA YARA 100ML EDP SPRAY' }).marca_empresa).toBe('Lattafa');
    expect(extractMarcaEmpresaFromTitle({ title: 'Hugo Boss Bottle Infinity' }).marca_empresa).toBe('Hugo Boss');
    expect(extractMarcaEmpresaFromTitle({ title: 'Ariana Grande Sweet Like Candy' }).marca_empresa).toBe('Ariana Grande');
    expect(extractMarcaEmpresaFromTitle({ title: 'Cacharel Amor Amor' }).marca_empresa).toBe('Cacharel');
    expect(extractMarcaEmpresaFromTitle({ title: 'DKNY Be Delicious' }).marca_empresa).toBe('DKNY');
  });

  it('extracts appliance and house brands', () => {
    expect(extractMarcaEmpresaFromTitle({ title: 'Lavadora LG Carga Superior Inverter 19kg' }).marca_empresa).toBe('LG');
    expect(extractMarcaEmpresaFromTitle({ title: 'CAMPANA 50CM PLATA MABE' }).marca_empresa).toBe('MABE');
    expect(extractMarcaEmpresaFromTitle({ title: '2025 CARABELA DIRT3 250CC' }).marca_empresa).toBe('CARABELA');
    expect(extractMarcaEmpresaFromTitle({ title: 'Cafetera Multicapsula Nüür' }).marca_empresa).toBe('NUUR');
    expect(extractMarcaEmpresaFromTitle({ title: 'BOGNER Cafetera espresso BCM35' }).marca_empresa).toBe('BOGNER');
    expect(extractMarcaEmpresaFromTitle({ title: 'AMAZON ECHO SHOW 11' }).marca_empresa).toBe('Amazon');
    expect(extractMarcaEmpresaFromTitle({ title: 'Laptop Acer Aspire Lite' }).marca_empresa).toBe('Acer');
    expect(extractMarcaEmpresaFromTitle({ title: 'LAPTOP HP 14.0 HD LED' }).marca_empresa).toBe('HP');
    expect(extractMarcaEmpresaFromTitle({ title: 'LENOVO V15 G4 AMN' }).marca_empresa).toBe('Lenovo');
  });

  it('extracts Garow without confusing generic Moto wording with Motorola', () => {
    expect(extractMarcaEmpresaFromTitle({ title: 'Garow Moto CIELO' })).toMatchObject({
      marca_empresa: 'Garow',
      marca_empresa_confianza: 'high',
      marca_empresa_source: 'title_rule',
    });
  });

  it('returns pending when no controlled brand rule matches', () => {
    expect(extractMarcaEmpresaFromTitle({ title: 'Producto sin marca clara' })).toMatchObject({
      marca_empresa_confianza: 'pending',
      marca_empresa_source: 'none',
    });
  });
});
