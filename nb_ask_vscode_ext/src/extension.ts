import * as vscode from 'vscode';
import express, { type Express, type Request, type Response } from 'express';
import { Server } from 'http';


let server: Server | undefined;
let _default_port: number = 3000;
let port: number = _default_port;

function getCellsContent() {
	const editor = vscode.window.activeNotebookEditor;
	const nb = editor?.notebook;
	const activeCellIndex = editor?.selection.start ?? 0;
	const cells = nb?.getCells()
		.slice(0, activeCellIndex)
		.map((cell, index) => ({
			index,
			kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
			source: cell.document.getText(),
			outputs: cell.outputs.map(o => o.items.map(i => Buffer.from(i.data).toString()).join(''))
		}));
	return cells;
}

function startServer(port: number) {
	if (server === undefined) {
		const app: Express = express();

		app.get("/", (req: Request, res: Response) => {
			res.json(getCellsContent());
		});

		server = app.listen(port, () => {
			console.log(`NBAsk services provided on port: ${port}`);
		});
	}
	else {
		console.log(`NBAsk server already running at ${port}`);
	};
}

function stopServer() {
	if (server === undefined) {
		console.log("No NBAsk server running...");
	}
	else {
		console.log("Closing NBAsk server...");
		server.close();
		server = undefined;
	};
}

function maybeRestartServer(port: number) {
	if (server !== undefined) {
		console.log(`Restart NBAsk server with new port: ${port}`);
		stopServer();
		startServer(port);
	};
}


export function activate(context: vscode.ExtensionContext) {
	// Keep that as comment, maybe want to add this back in later...
	/*context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.set_token', async () => {
			const token = await vscode.window.showInputBox({ prompt: 'Enter token', password: true });
			if (token) {
				await context.secrets.store('nb_ask.token', token);
			};
		})
	);
	*/
	console.log("Activating nb_ask extension...");

	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.set_port', async () => {
			let _port = (await vscode.window.showInputBox({ prompt: 'Enter port:' })) ?? '3001';
			let parsedPort = parseInt(_port, 10);
			if (isNaN(parsedPort)) {
				vscode.window.showErrorMessage(`Invalid port number: ${_port}`, { modal: true });
				return;
			}
			port = parsedPort;
			maybeRestartServer(port);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.start', async () => {
			startServer(port);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.stop', async () => {
			stopServer();
		})
	);

}

export function deactivate() {
	stopServer();
}
