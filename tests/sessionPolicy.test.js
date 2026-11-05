const { strictSessions } = require('../src/config/sessionPolicy');
test.each(['production', 'staging'])(
  '%s fails startup with missing shared store configuration',
  (environment) => {
    const saved = { ...process.env };
    try {
      process.env.NODE_ENV = environment;
      delete process.env.REDIS_URL;
      jest.isolateModules(() => {
        expect(() => require('../src/config/environment')).toThrow(
          /Missing required environment variables/,
        );
      });
      // Invalid strict configuration must fail, never resolve a sid-less fallback.
      expect(() => strictSessions()).toThrow(/Missing required environment variables/);
    } finally {
      process.env = saved;
    }
  },
);
