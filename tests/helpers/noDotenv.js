// Loaded only by the B01 test runner's Node children. Test fixtures must not
// import developer .env credentials, including migration/HTTP subprocesses.
require('dotenv').config = () => ({ parsed: {} });
