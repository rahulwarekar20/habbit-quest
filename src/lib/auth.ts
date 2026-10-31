/** Parent PINs are checked by the backend; this is only the shape check before sending one. */
export const isValidPin = (pin: string) => /^\d{4}$/.test(pin);
