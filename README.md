# Graph Whisperer

Professional-grade VS Code extension for RDF/SPARQL development, optimized for GraphDB.

## Prerequisites

- [GraphDB](https://graphdb.ontotext.com/) instance (running locally or remotely).
- [Docker](https://www.docker.com/) (if running GraphDB via Docker).
- [Node.js](https://nodejs.org/) (v18+).

## Setup from Source

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/yourusername/graph-whisperer.git
    cd graph-whisperer
    ```

2.  **Fix npm permissions (if you encounter EPERM errors):**
    If `npm install` fails with `mkdir: node_modules: Operation not permitted`, run:

    ```bash
    sudo rm -rf node_modules
    sudo chown -R $(whoami) .
    npm install
    ```

3.  **Running the Extension:**
    - Open the project in VS Code: `code .`
    - Press `F5` to open a new VS Code window with the extension loaded.
    - Open logic `.sparql` file.
    - Run the command `Graph Whisperer: Run SPARQL Query`.

## Configuration

Set the following in your VS Code settings:

- `graphwhisperer.endpoint`: URL to your GraphDB repository (default: `http://localhost:7200/repositories/my-repo`)
- `graphwhisperer.username`: (Optional) Basic Auth username.

## Features

- Execute SPARQL queries from `.sparql` files.
- View results in the Output panel (Phase 1).
- Connection to basic auth secured endpoints.
