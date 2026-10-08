import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { token } from './catalogSupport';
import { rolledBackSql } from './testApi';

/**
 * Ticket 14 database guarantees (changeset `013-catalog`), checked in the schema the test API migrated. Every
 * statement runs in a transaction that is rolled back, so nothing is left behind. These pass once T2's migration is in
 * the built jar, before any catalog route exists.
 */

const catalogTables = ['product_categories', 'product_changes', 'products'];

type Row = { kind?: string; generic?: string | null; dosage?: string | null; price?: string | null; mrp?: string | null;
  active?: boolean };

function sqlValue(value: string | boolean | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${value}'`;
}

/** Inserts one Product row, with its own new category, exactly as raw SQL or a service bug could. */
function insertProduct(row: Row): string {
  const { kind = 'EQUIPMENT', generic = null, dosage = null, price = null, mrp = null, active = false } = row;
  return `WITH category AS (INSERT INTO product_categories (id, name, created_at, updated_at)
      VALUES (gen_random_uuid(), 'Db check ${token()}', now(), now()) RETURNING id)
    INSERT INTO products (id, kind, name, generic_name, dosage_form, sale_unit, category_id, selling_price, mrp, active,
      created_at, updated_at)
    SELECT gen_random_uuid(), ${sqlValue(kind)}, 'Db check', ${sqlValue(generic)}, ${sqlValue(dosage)}, '1 piece', id,
      ${sqlValue(price)}, ${sqlValue(mrp)}, ${sqlValue(active)}, now(), now() FROM category;`;
}

test('E2E-14-01 the catalog schema has no stock, reservation, batch, expiry or pack columns and stores money as NUMERIC(9,2)',
  { tag: ['@t14', '@t14-T2'] }, () => {
    const tables = rolledBackSql(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY 1;");
    expect(tables.error).toBe('');
    const tableNames = tables.output.split(/\r?\n/);
    for (const table of catalogTables) expect(tableNames).toContain(table);
    // AC5: no stock anywhere, not even as a separate table.
    expect(tableNames.filter((name) => /stock|inventor|reserv|batch|expir|pack/i.test(name))).toEqual([]);

    const columns = rolledBackSql(`SELECT table_name || '.' || column_name || ' ' || data_type
        || coalesce(' ' || numeric_precision || ',' || numeric_scale, '')
      FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name IN (${catalogTables.map((table) => `'${table}'`).join(', ')}) ORDER BY 1;`);
    expect(columns.error).toBe('');
    const lines = columns.output.split(/\r?\n/);
    expect(lines.filter((line) => /stock|quantity|qty|reserv|batch|expir|pack/i.test(line.split(' ')[0]))).toEqual([]);

    const money = ['products.selling_price', 'products.mrp', 'product_changes.old_selling_price',
      'product_changes.new_selling_price', 'product_changes.old_mrp', 'product_changes.new_mrp'];
    for (const column of money) expect(lines).toContain(`${column} numeric 9,2`);
    // Nothing else holds money, so nothing can store a rounded or floating-point copy.
    expect(lines.filter((line) => / (real|double precision)/.test(line))).toEqual([]);
    for (const column of ['products.sale_unit', 'products.require_validation', 'products.active', 'products.version',
      'product_categories.active', 'product_categories.version']) {
      expect(lines.some((line) => line.startsWith(`${column} `)), column).toBe(true);
    }
  });

test('E2E-14-02 the database refuses an active unpriced Product and every other invalid Product row',
  { tag: ['@t14', '@t14-T2'] }, () => {
    // Positive controls prove the statement itself is valid, so each refusal below is the constraint's.
    expect(rolledBackSql(insertProduct({ price: '450.00', active: true })).error).toBe('');
    expect(rolledBackSql(insertProduct({ kind: 'MEDICINE', generic: 'Paracetamol', dosage: 'Tablet 500 mg' })).error)
      .toBe('');
    expect(rolledBackSql(insertProduct({ price: '12.00', mrp: '12.00', active: true })).error).toBe('');

    const refused: [string, Row, RegExp][] = [
      ['an active unpriced Product (AC2)', { active: true }, /ck_products_active_priced/],
      ['a selling price above the MRP', { price: '12.01', mrp: '12.00' }, /ck_products_price_le_mrp/],
      ['an MRP without a selling price', { mrp: '12.00' }, /ck_products_mrp_needs_price/],
      ['a non-finite active selling price', { price: 'NaN', active: true }, /ck_products_selling_price_finite/],
      ['a non-finite MRP', { price: '1.00', mrp: 'NaN' }, /ck_products_mrp_finite/],
      ['a zero selling price', { price: '0.00' }, /violates check constraint/],
      ['a negative MRP', { price: '1.00', mrp: '-1.00' }, /violates check constraint/],
      ['a Medicine without a generic name', { kind: 'MEDICINE', dosage: 'Tablet 500 mg' }, /ck_products_medicine_fields/],
      ['a Medicine without a dosage form', { kind: 'MEDICINE', generic: 'Paracetamol' }, /ck_products_medicine_fields/],
      ['Equipment with a generic name', { generic: 'Paracetamol' }, /ck_products_equipment_fields/],
      ['Equipment with a dosage form', { dosage: 'Tablet 500 mg' }, /ck_products_equipment_fields/],
      ['an unknown kind', { kind: 'SERVICE' }, /violates check constraint/],
      ['more than 7 whole digits of money', { price: '10000000.00' }, /numeric field overflow/],
    ];
    for (const [name, row, error] of refused) expect(rolledBackSql(insertProduct(row)).error, name).toMatch(error);
  });

test('E2E-14-03 the database keeps category names unique ignoring case and never deletes referenced rows',
  { tag: ['@t14', '@t14-T2'] }, () => {
    const suffix = token();
    const category = (id: string, name: string) =>
      `INSERT INTO product_categories (id, name, created_at, updated_at) VALUES ('${id}', '${name}', now(), now());`;
    expect(rolledBackSql(category(randomUUID(), `Unique ${suffix}`) + category(randomUUID(), `unique ${suffix}x`)).error)
      .toBe('');
    expect(rolledBackSql(category(randomUUID(), `Unique ${suffix}`) + category(randomUUID(), `UNIQUE ${suffix.toUpperCase()}`))
      .error).toMatch(/uk_product_categories_name/);

    const categoryId = randomUUID();
    const productId = randomUUID();
    const referenced = category(categoryId, `Restrict ${suffix}`)
      + `INSERT INTO products (id, kind, name, sale_unit, category_id, active, created_at, updated_at)
           VALUES ('${productId}', 'EQUIPMENT', 'Restrict', '1 piece', '${categoryId}', FALSE, now(), now());
         INSERT INTO product_changes (id, product_id, occurred_at, change_type)
           VALUES (gen_random_uuid(), '${productId}', now(), 'CREATED');`;
    expect(rolledBackSql(referenced).error).toBe('');
    // AC3: a Category in use and a Product with history cannot be deleted, even with raw SQL.
    expect(rolledBackSql(`${referenced} DELETE FROM product_categories WHERE id = '${categoryId}';`).error)
      .toMatch(/violates (?:RESTRICT setting of )?foreign key constraint/);
    expect(rolledBackSql(`${referenced} DELETE FROM products WHERE id = '${productId}';`).error)
      .toMatch(/violates (?:RESTRICT setting of )?foreign key constraint/);
    expect(rolledBackSql(`${referenced} INSERT INTO product_changes (id, product_id, occurred_at, change_type)
        VALUES (gen_random_uuid(), '${productId}', now(), 'DELETED');`).error).toMatch(/violates check constraint/);
  });
