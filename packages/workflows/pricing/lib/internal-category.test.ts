import { describe, expect, it } from 'vitest';
import { resolveInternalCategory } from './internal-category.js';

describe('resolveInternalCategory', () => {
  it('uses normalized Shopify product_type when available', () => {
    expect(resolveInternalCategory({
      title: 'IPHONE 15 PRO MAX',
      product_type: 'celular',
    })).toMatchObject({
      categoria_interna: 'Celulares',
      categoria_confianza: 'medium',
      categoria_source: 'shopify',
    });
  });

  it('infers celular from title when product_type is missing', () => {
    expect(resolveInternalCategory({
      title: 'IPHONE 15 PRO MAX RFB 5G ESIM 256GB',
      vendor_shopify: 'CELMI',
      marca_empresa: 'Apple',
    })).toMatchObject({
      categoria_interna: 'Celulares',
      categoria_confianza: 'medium',
      categoria_source: 'title_rule',
    });
  });

  it('infers lavadora, microondas and audio from title', () => {
    expect(resolveInternalCategory({
      title: 'Lavadora LG Carga Superior Inverter 19kg',
    })).toMatchObject({
      categoria_interna: 'Lavadora',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Horno Microondas LG NeoChef EasyClean',
    })).toMatchObject({
      categoria_interna: 'Microondas',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Bocina LG XBOOM Go XG8T',
    })).toMatchObject({
      categoria_interna: 'Audio',
      categoria_source: 'title_rule',
    });
  });

  it('infers pantallas and campana from title', () => {
    expect(resolveInternalCategory({
      title: 'Pantalla 50 pulgadas LG UHD AI UA80 4K Smart TV 2025',
    })).toMatchObject({
      categoria_interna: 'Pantallas',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Campana Extractora De Cocina Mabe 50cm Plata',
    })).toMatchObject({
      categoria_interna: 'Campana',
      categoria_source: 'title_rule',
    });
  });

  it('infers moto from Carabela and engine displacement signals', () => {
    expect(resolveInternalCategory({
      title: '2025 DIRT3 roja 250cc',
      vendor_shopify: 'CARABELA',
    })).toMatchObject({
      categoria_interna: 'MOTO',
      categoria_source: 'title_rule',
    });
  });

  it('infers fragancia, descanso and computacion from title', () => {
    expect(resolveInternalCategory({
      title: 'Calvin Klein Eternity Dama',
    })).toMatchObject({
      categoria_interna: 'Fragancia',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Colchon matrimonial memory foam',
    })).toMatchObject({
      categoria_interna: 'Descanso/Colchon',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Monitor gamer 27 pulgadas',
    })).toMatchObject({
      categoria_interna: 'Computacion',
      categoria_source: 'title_rule',
    });
  });

  it('infers operational appliance categories from title', () => {
    expect(resolveInternalCategory({
      title: 'Calentador instantaneo gas LP 12 litros',
    })).toMatchObject({
      categoria_interna: 'Calentador',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Cafetera automatica espresso',
    })).toMatchObject({
      categoria_interna: 'Cafetera',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Maquina para hacer hielo 12kg',
    })).toMatchObject({
      categoria_interna: 'Maquina Hielo',
      categoria_source: 'title_rule',
    });
  });

  it('infers remaining real Shopify categories from title', () => {
    expect(resolveInternalCategory({
      title: 'Ariana Grande Sweet Like Candy',
    })).toMatchObject({
      categoria_interna: 'Fragancia',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'CERRADURA DIGITAL INTELIGENTE CON 5 TARJETAS',
    })).toMatchObject({
      categoria_interna: 'Cerradura',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'ENFRIADOR DE BEBIDAS CAPACIDAD 80L',
    })).toMatchObject({
      categoria_interna: 'Refrigerador',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'BATERIA APILABLE 12pzs',
    })).toMatchObject({
      categoria_interna: 'Ollas',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Lavavajillas LG con Dynamic Dry Empotre',
    })).toMatchObject({
      categoria_interna: 'Lavavajillas',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'LG MICROHONDAS MOD. MS1596CIR',
    })).toMatchObject({
      categoria_interna: 'Microondas',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'LG TONE Free T90S con Dolby Atmos',
    })).toMatchObject({
      categoria_interna: 'Audio',
      categoria_source: 'title_rule',
    });

    expect(resolveInternalCategory({
      title: 'Halloween',
      vendor_shopify: 'TopSeller',
    })).toMatchObject({
      categoria_interna: 'Fragancia',
      categoria_source: 'title_rule',
    });
  });

  it('prefers specific title signal over generic electrodomesticos product_type', () => {
    expect(resolveInternalCategory({
      title: 'Horno Microondas LG NeoChef EasyClean',
      product_type: 'Electrodomesticos',
    })).toMatchObject({
      categoria_interna: 'Microondas',
      categoria_source: 'title_rule',
    });
  });

  it('keeps ambiguous products pending', () => {
    expect(resolveInternalCategory({
      title: 'Producto especial sin datos suficientes',
      vendor_shopify: 'Proveedor Nuevo',
    })).toMatchObject({
      categoria_confianza: 'pending',
      categoria_source: 'none',
    });
  });
});
