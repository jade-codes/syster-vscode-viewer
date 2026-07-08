import * as vscode from 'vscode';
import { DiagramPanel } from './diagram-panel';

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    console.log('SysML Diagram Viewer extension is activating...');

    // Register show diagram command
    const showDiagramCommand = vscode.commands.registerCommand('syster.showDiagram', () => {
        vscode.window.showInformationMessage('Opening SysML Diagram...');
        console.log('[Viewer] showDiagram command executed');
        DiagramPanel.createOrShow(context.extensionUri);
    });

    context.subscriptions.push(showDiagramCommand);

    // Register command to switch the applied SysML v2 view.
    const selectViewCommand = vscode.commands.registerCommand('syster.selectDiagramView', () => {
        if (DiagramPanel.currentPanel) {
            void DiagramPanel.currentPanel.selectView();
        } else {
            vscode.window.showInformationMessage('Open the SysML Diagram first, then select a view.');
        }
    });

    context.subscriptions.push(selectViewCommand);

    console.log('✓ SysML Diagram Viewer extension activated');
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
    console.log('SysML Diagram Viewer extension deactivated');
}
