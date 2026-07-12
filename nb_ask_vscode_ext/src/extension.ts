import * as vscode from 'vscode';
import express, { type Express, type Request, type Response } from 'express';
import { Server } from 'http';


let server: Server | undefined;
let _default_port: number = 3000;
let port: number = _default_port;


function start_server(port: number) {
	if (server === undefined) {
		const app: Express = express();

		app.get("/", (req: Request, res: Response) => {
			const nb = vscode.window.activeNotebookEditor?.notebook;
			const cells = nb?.getCells().map((cell, index) => ({
				index,
				kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
				source: cell.document.getText(),
				outputs: cell.outputs.map(o => o.items.map(i => Buffer.from(i.data).toString()).join(''))
			}));
			res.json(cells);
		});

		server = app.listen(port, () => {
			console.log(`NBAsk services provided on port: ${port}`);
		});
	}
	else {
		console.log(`NBAsk server already running at ${port}`);
	};
}

function stop_server() {
	if (server === undefined) {
		console.log("No NBAsk server running...");
	}
	else {
		console.log("Closing NBAsk server...");
		server?.close();
		server = undefined;
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
	console.log("Avctivationg nb_ask extension");

	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.set_port', async () => {
			port = parseInt((await vscode.window.showInputBox({ prompt: 'Enter port:' })) ?? '3001', 10);
			stop_server();
			start_server(port);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.start', async () => {
			start_server(port);
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('nb_ask.stop', async () => {
			stop_server();
		})
	);

}

export function deactivate() { 
	stop_server();
}
