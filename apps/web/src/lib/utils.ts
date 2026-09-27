import { type ClassValue, clsx } from 'clsx';
import type { SvelteComponent } from 'svelte';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type WithElementRef<T> = T & {
  ref?: SvelteComponent | HTMLElement | null;
};

export type WithoutChildren<T> = Omit<T, 'children'>;
