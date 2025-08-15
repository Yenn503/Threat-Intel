import { server } from './server.js';

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log('Backend listening on ' + port);
  console.log('Assessment routes: /api/assess/whois , /api/assess/shodan');
});
