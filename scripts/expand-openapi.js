const fs = require('fs');

const spec = JSON.parse(fs.readFileSync('docs/api.openapi.json', 'utf8'));

function makeOp(summary, opId, desc, fields = {}) {
  return {
    summary,
    operationId: opId,
    description: desc,
    'x-csrf':
      'Cookie writes without Authorization require X-TotMart-Request: 1. CORS allowlist applies.',
    'x-ownership': 'Authenticated user bound to token identity.',
    'x-idempotency': 'Idempotent or state-guarded mutation.',
    'x-retry-recovery': 'Transient errors fail with 503; retryable with safe backoff.',
    ...fields,
  };
}

// 1. POST /checkout/quote
spec.paths['/checkout/quote'] = {
  post: makeOp(
    'Calculate commerce quote',
    'post_checkout_quote',
    'Calculates line items, combo boxes, gift wraps, bulk discounts, and coupon.',
    {
      responses: {
        200: {
          description: 'Quote calculated',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/QuoteResponse' } },
          },
        },
        400: {
          description: 'Invalid input or insufficient stock',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
      },
    },
  ),
};

// 2. POST /checkout/cancel/{_id}
spec.paths['/checkout/cancel/{_id}'] = {
  post: makeOp(
    'Cancel order',
    'post_checkout_cancel_id',
    'Cancels pending order and restores stock/coupon.',
    {
      parameters: [
        {
          name: '_id',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^[a-f0-9]{24}$' },
        },
      ],
      responses: {
        200: {
          description: 'Order cancelled',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } },
          },
        },
        400: {
          description: 'Invalid param or reason',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
        404: {
          description: 'Order not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 3. GET /checkout/sessions/{paymentCode}
spec.paths['/checkout/sessions/{paymentCode}'] = {
  get: makeOp(
    'Get checkout session status',
    'get_checkout_session',
    'Retrieves online checkout session by paymentCode.',
    {
      parameters: [{ name: 'paymentCode', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'Session found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CheckoutSessionResponse' },
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
        404: {
          description: 'Session not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 4. POST /checkout/sessions/{paymentCode}/cancel
spec.paths['/checkout/sessions/{paymentCode}/cancel'] = {
  post: makeOp(
    'Cancel checkout session',
    'post_checkout_session_cancel',
    'Atomically cancels pending online session and releases coupon.',
    {
      parameters: [{ name: 'paymentCode', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'Session cancelled',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } },
          },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
        404: {
          description: 'Session not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        409: {
          description: 'Non-cancellable state',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 5. GET /checkout/order-status/{paymentCode}
spec.paths['/checkout/order-status/{paymentCode}'] = {
  get: makeOp(
    'Get order status by payment code',
    'get_checkout_order_status',
    'Checks order fulfillment status by paymentCode.',
    {
      parameters: [{ name: 'paymentCode', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'Status retrieved',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/OrderStatusResponse' } },
          },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
        404: {
          description: 'Order not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 6. GET /carts/get-cart/{_id}
spec.paths['/carts/get-cart/{_id}'] = {
  get: makeOp(
    'Get user cart',
    'get_cart_by_user',
    'Retrieves active cart for authenticated user.',
    {
      parameters: [{ name: '_id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'Cart retrieved',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
      },
    },
  ),
};

// 7. POST /carts/add-to-cart
spec.paths['/carts/add-to-cart'] = {
  post: makeOp(
    'Add item to cart',
    'post_carts_add_to_cart',
    'Adds product with optimistic concurrency protection.',
    {
      responses: {
        200: {
          description: 'Added to existing cart',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        201: {
          description: 'Created new cart',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        400: {
          description: 'Validation failed or out of stock',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
      },
    },
  ),
};

// 8. PUT /carts/sync
spec.paths['/carts/sync'] = {
  put: makeOp(
    'Sync localStorage cart',
    'put_carts_sync',
    'Replaces user cart with localStorage items.',
    {
      responses: {
        200: {
          description: 'Cart synced',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SyncCartResponse' } },
          },
        },
        400: {
          description: 'Validation failed or invalid product',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
        409: {
          description: 'Version conflict',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 9. PUT /carts/update-cart/{_id}
spec.paths['/carts/update-cart/{_id}'] = {
  put: makeOp(
    'Update item quantity in cart',
    'put_carts_update_cart',
    'Updates quantity with optimistic concurrency protection.',
    {
      parameters: [
        {
          name: '_id',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^[a-f0-9]{24}$' },
        },
      ],
      responses: {
        200: {
          description: 'Item updated',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        201: {
          description: 'Created new cart',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        400: {
          description: 'Validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
      },
    },
  ),
};

// 10. DELETE /carts/delete-from-cart/{_id}
spec.paths['/carts/delete-from-cart/{_id}'] = {
  delete: makeOp(
    'Delete item from cart',
    'delete_carts_from_cart',
    'Removes item from cart and refreshes totals.',
    {
      parameters: [
        {
          name: '_id',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^[a-f0-9]{24}$' },
        },
      ],
      responses: {
        200: {
          description: 'Item deleted',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        400: {
          description: 'Validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
        404: {
          description: 'Not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 11. POST /carts/add-subscribe-plan-to-cart
spec.paths['/carts/add-subscribe-plan-to-cart'] = {
  post: makeOp(
    'Add subscribe plan to cart',
    'post_carts_add_subscribe',
    'Adds subscription template item to subscribe cart.',
    {
      responses: {
        200: {
          description: 'Item added',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        201: {
          description: 'Created subscribe cart',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        400: {
          description: 'Validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
      },
    },
  ),
};

// 12. PUT /carts/update-subscribe-cart
spec.paths['/carts/update-subscribe-cart'] = {
  put: makeOp(
    'Update subscribe cart item',
    'put_carts_update_subscribe',
    'Updates subscribe plan quantity in cart.',
    {
      responses: {
        200: {
          description: 'Item updated',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        201: {
          description: 'Created subscribe cart',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        400: {
          description: 'Validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
      },
    },
  ),
};

// 13. DELETE /carts/delete-from-subscribe-cart/{_id}
spec.paths['/carts/delete-from-subscribe-cart/{_id}'] = {
  delete: makeOp(
    'Delete item from subscribe cart',
    'delete_carts_from_subscribe',
    'Removes subscription plan from subscribe cart.',
    {
      parameters: [
        {
          name: '_id',
          in: 'path',
          required: true,
          schema: { type: 'string', pattern: '^[a-f0-9]{24}$' },
        },
      ],
      responses: {
        200: {
          description: 'Item deleted',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CartResponse' } },
          },
        },
        400: {
          description: 'Validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
        404: {
          description: 'Not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 14. GET /carts/get-subscribe-cart/{_id}
spec.paths['/carts/get-subscribe-cart/{_id}'] = {
  get: makeOp(
    'Get user subscribe cart',
    'get_subscribe_cart_by_user',
    'Retrieves subscribe cart and gifts for user.',
    {
      parameters: [{ name: '_id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: {
        200: {
          description: 'Subscribe cart retrieved',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SubscribeCartResponse' },
            },
          },
        },
        401: {
          description: 'Unauthorized',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthError' } } },
        },
      },
    },
  ),
};

// 15. POST /home/forgot-password
spec.paths['/home/forgot-password'] = {
  post: makeOp(
    'Forgot password request',
    'post_home_forgot_password',
    'Sends password reset token email.',
    {
      responses: {
        200: {
          description: 'Generic sent message',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } },
          },
        },
        400: {
          description: 'Validation failed',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        429: {
          description: 'Rate limit exceeded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 16. POST /home/reset-password
spec.paths['/home/reset-password'] = {
  post: makeOp(
    'Reset password',
    'post_home_reset_password',
    'Resets user password with valid token.',
    {
      responses: {
        200: {
          description: 'Password reset successful',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SuccessResponse' } },
          },
        },
        400: {
          description: 'Invalid or expired token',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        429: {
          description: 'Rate limit exceeded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// 17. GET /home/health
spec.paths['/home/health'] = {
  get: makeOp(
    'System health check',
    'get_home_health',
    'Returns connectivity and readiness status for DB and Redis.',
    {
      security: [],
      'x-csrf': 'Public read operation; CSRF check omitted.',
      'x-ownership': 'Public status probe.',
      'x-idempotency': 'Read-only idempotent probe.',
      'x-retry-recovery': 'Probe can be queried periodically.',
      responses: {
        200: {
          description: 'System healthy',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } },
          },
        },
        503: {
          description: 'System degraded',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      },
    },
  ),
};

// Schemas
const newSchemas = {
  SuccessResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      message: { type: 'string' },
      data: { type: 'object', nullable: true },
    },
    required: ['success'],
    additionalProperties: true,
  },
  HealthResponse: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['ok'] },
      db: { type: 'string' },
      redis: { type: 'string' },
      uptime: { type: 'number' },
      timestamp: { type: 'string' },
    },
    required: ['status', 'db', 'redis'],
    additionalProperties: true,
  },
  QuoteResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: { type: 'object' },
    },
    required: ['success', 'data'],
    additionalProperties: true,
  },
  CartResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string' },
      data: { type: 'object', nullable: true },
    },
    required: ['success'],
    additionalProperties: true,
  },
  SyncCartResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: { type: 'object', nullable: true },
      skipped: { type: 'array' },
      version: { type: 'integer' },
    },
    required: ['success'],
    additionalProperties: true,
  },
  SubscribeCartResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      message: { type: 'string' },
      data: { type: 'object', nullable: true },
      gift: { type: 'array' },
    },
    required: ['success'],
    additionalProperties: true,
  },
  CheckoutSessionResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: { type: 'object' },
    },
    required: ['success', 'data'],
    additionalProperties: true,
  },
  OrderStatusResponse: {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: { type: 'object' },
    },
    required: ['success', 'data'],
    additionalProperties: true,
  },
};

Object.assign(spec.components.schemas, newSchemas);

fs.writeFileSync('docs/api.openapi.json', JSON.stringify(spec, null, 2) + '\n');
if (fs.existsSync('fe-handover/api.openapi.json')) {
  fs.writeFileSync('fe-handover/api.openapi.json', JSON.stringify(spec, null, 2) + '\n');
}
console.log(
  'Updated api.openapi.json with',
  Object.values(spec.paths).reduce((c, o) => c + Object.keys(o).length, 0),
  'operations.',
);
