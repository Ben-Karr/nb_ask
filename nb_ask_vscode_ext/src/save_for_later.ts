/*const target = await vscode.window.showQuickPick(
    [
        {
            label: "Set token for A",
            description: "Uses service A",
            key: "a",
        },
        {
            label: "Set token for B",
            description: "Uses service B",
            key: "b",
        },
    ],
    {
        placeHolder: "Select which token to configure",
    }
);

if (!target) {
    return; // User cancelled
}

const token = await vscode.window.showInputBox({
    prompt: `Enter token for ${target.label}`,
    password: true,
});

if (token) {
    await context.secrets.store(`nb_ask.token.${target.key}`, token);
}*/