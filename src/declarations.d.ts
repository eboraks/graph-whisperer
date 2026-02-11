declare module 'sparql-http-client' {
    export default class SparqlClient {
      constructor(options: { endpointUrl: string; user?: string; password?: string });
      query: {
        select(query: string): Promise<any>;
        construct(query: string): Promise<any>;
        ask(query: string): Promise<boolean>;
      };
    }
}
