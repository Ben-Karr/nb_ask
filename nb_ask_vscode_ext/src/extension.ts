import * as vscode from 'vscode';
import express, { type Express, type Request, type Response } from 'express';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		vscode.commands.registerCommand('helloworld.setToken', async () => {
			const token = await vscode.window.showInputBox({ prompt: 'Enter token', password: true });
			if (token) {
				await context.secrets.store('helloworld.token', token);
			};
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('helloworld.helloWorld', async () => {
			const token = await context.secrets.get('helloworld.token');
			vscode.window.showInformationMessage(`Token: ${token ?? 'not set'}`, {modal: true});
		})
	);
	context.subscriptions.push(
		vscode.commands.registerCommand('helloworld.count', async () => {
			const nb = vscode.window.activeNotebookEditor?.notebook;
			const count = nb?.cellCount;
			vscode.window.showInformationMessage(`Number of Cells in  Notebook: ${count}`, {modal: true});
		})
	);

	const app: Express = express();
	const port = 3001;

	app.get("/", (req: Request, res: Response) => {
		const nb = vscode.window.activeNotebookEditor?.notebook;
		const count = nb?.cellCount;
		const cells = nb?.getCells().map((cell, index) => ({
			index,
			kind: cell.kind === vscode.NotebookCellKind.Code ? 'code' : 'markdown',
			source: cell.document.getText(),
			outputs: cell.outputs.map(o => o.items.map(i => Buffer.from(i.data).toString()).join(''))
		}));
		res.json(cells);
	});

	app.listen(port, () => {
		console.log(`Exammple app listening on port ${port}`);
	});

}

export function deactivate() { }
