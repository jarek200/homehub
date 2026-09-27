import { describe, expect, it } from 'vitest';
import {
  CORES3_PRODUCTS,
  cores3ProductById,
  nextMatterDeviceId,
  nextMatterNodeId,
  nextProductName,
} from './cores3-products';

describe('cores3 products', () => {
  it('lists the commissioned IKEA products', () => {
    expect(CORES3_PRODUCTS.map((product) => product.productId)).toEqual([
      'kajplats',
      'timmerflotte',
      'myggspray',
      'myggbett',
      'alpstuga',
      'klippbok',
      'grillplats',
    ]);
    expect(cores3ProductById('kajplats')?.type).toBe('light');
    expect(cores3ProductById('timmerflotte')?.clusterEndpoints).toEqual({
      humidity: 2,
      battery: 0,
    });
    expect(cores3ProductById('myggspray')?.clusterEndpoints).toEqual({
      occupancy: 2,
      illuminance: 1,
      battery: 0,
    });
  });

  it('names a second KAJPLATS without colliding', () => {
    expect(nextProductName('KAJPLATS', [])).toBe('KAJPLATS');
    expect(nextProductName('KAJPLATS', ['KAJPLATS'])).toBe('KAJPLATS 2');
    expect(nextProductName('KAJPLATS', ['KAJPLATS', 'KAJPLATS 2'])).toBe('KAJPLATS 3');
  });

  it('allocates the next catalog id after the highest matter-N', () => {
    expect(nextMatterDeviceId([])).toBe('matter-1');
    expect(nextMatterDeviceId(['matter-1', 'matter-10', 'cores3-gateway'])).toBe('matter-11');
  });

  it('skips leftover node 6 and unpaired BILRESA node 8', () => {
    expect(nextMatterNodeId([])).toBe(1);
    expect(nextMatterNodeId([1, 2, 3, 4, 5, 7, 9, 10, 11])).toBe(12);
  });
});
