// Shared Razorpay Checkout loader + types, used by both the subscription flow
// (subscription_id) and the leads payment flow (order_id).

export interface RazorpayHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id?: string;
  razorpay_subscription_id?: string;
  razorpay_signature?: string;
}

export interface RazorpayCheckoutOptions {
  key: string;
  name: string;
  description?: string;
  order_id?: string;
  subscription_id?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  method?: {
    card?: boolean;
    netbanking?: boolean;
    wallet?: boolean;
    upi?: boolean;
    paylater?: boolean;
  };
  handler: (response: RazorpayHandlerResponse) => void;
  modal?: { ondismiss?: () => void };
}

export interface RazorpayInstance {
  open(): void;
  close(): void;
}

declare global {
  interface Window {
    Razorpay: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

const RAZORPAY_CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";

let razorpayScriptPromise: Promise<void> | null = null;

export const loadRazorpayScript = (): Promise<void> => {
  if (window.Razorpay) return Promise.resolve();
  razorpayScriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = RAZORPAY_CHECKOUT_URL;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load Razorpay checkout script"));
    document.body.appendChild(script);
  });
  return razorpayScriptPromise;
};
