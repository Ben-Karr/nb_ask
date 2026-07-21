import * as vscode from 'vscode';
import express, { NextFunction, type Express, type Request, type Response } from 'express';
import { Server } from 'http';
import { createHash } from 'crypto';


let server: Server | undefined;
let _default_port: number = 3144;
let port: number = _default_port;

interface CellContent {
	index: number;
	kind: 'code' | 'markdown';
	source: string;
	outputs: string[];
}

function updateCellMetadata(
	precedingCells: CellContent[],
	activeCellIndex: number,
	nb: vscode.NotebookDocument) {
	if (nb.cellCount === 0) {
		return { activeCellId: '', precedingCellsHash: '' };
	};
	const precedingCellsHash = createHash('sha256').update(JSON.stringify(precedingCells)).digest("hex");
	const activeCell = nb.cellAt(activeCellIndex);
	const existingId = activeCell.metadata.uuid;
	const newMetadata = { ...activeCell.metadata, precedingCellsHash, uuid: existingId ?? crypto.randomUUID() };

	const edit = new vscode.WorkspaceEdit();
	edit.set(nb.uri, [vscode.NotebookEdit.updateCellMetadata(activeCellIndex, newMetadata)]);
	vscode.workspace.applyEdit(edit);
	return { activeCellId: newMetadata.uuid, precedingCellsHash };
}

function getCellsContent() {
	const editor = vscode.window.activeNotebookEditor;
	if (!editor) {
		return;
	};
	const nb = editor.notebook;
	const activeCellIndex = editor?.selection.start ?? 0;
	const precedingCells = nb.getCells()
		.slice(0, activeCellIndex)
		.map((cell, index): CellContent => ({
			index,
			kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
			source: cell.document.getText(),
			outputs: cell.outputs.map(o => o.items.map(i => Buffer.from(i.data).toString()).join(''))
		}));
	const { activeCellId, precedingCellsHash } = updateCellMetadata(precedingCells, activeCellIndex, nb);

	return { precedingCellsHash, precedingCells, activeCellId };
}

async function insertResponse(content: any, targetCellId: string) {
	const editor = vscode.window.activeNotebookEditor;
	if (!editor) {
		return 400;
	}
	const nb = editor.notebook;
	//const activeCellIndex = editor?.selection.start ?? 0;
	const targetCellIndex = nb.getCells().findIndex(c => c.metadata.uuid === targetCellId);

	const kind = vscode.NotebookCellKind.Markup;
	const edit = new vscode.WorkspaceEdit();
	const cellData = new vscode.NotebookCellData(
		kind,
		content,
		"markdown",
	);
	cellData.metadata = { requestId: targetCellId, uuid: crypto.randomUUID() };
	edit.set(nb?.uri, [
		vscode.NotebookEdit.insertCells(targetCellIndex + 1, [cellData])
	]);

	const success = await vscode.workspace.applyEdit(edit);
	return success ? 200 : 500;
}

function startServer(port: number) {
	if (server === undefined) {
		const app: Express = express();

		app.get("/", (req: Request, res: Response) => {
			res.json(getCellsContent());
		});

		app.use(express.json());

		app.post("/insert_response", async (req: Request, res: Response) => {
			const { content, targetCellHash } = req.body;
			const status = await insertResponse(content, targetCellHash);
			res.status(status).send();
		})

		server = app.listen(port, "127.0.0.1", () => {
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

	vscode.workspace.onDidChangeNotebookDocument(e => {
		for (const change of e.contentChanges) {
			//change.removedCells
			// loop through removedCells
		}
	});

}

export function deactivate() {
	stopServer();
}
