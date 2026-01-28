// API Key Help Dialog
// Provides instructions for obtaining API keys from different providers

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExternalLink, Key } from 'lucide-react';

interface ApiKeyHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ApiKeyHelpDialog({ open, onOpenChange }: ApiKeyHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            How to Get API Keys
          </DialogTitle>
          <DialogDescription>
            Follow these steps to obtain API keys from each provider
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Anthropic (Claude) */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Anthropic (Claude)</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('https://console.anthropic.com/', '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Console
              </Button>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Go to <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.anthropic.com</a></li>
              <li>Sign in or create an account</li>
              <li>Click on "API Keys" in the left sidebar</li>
              <li>Click "Create Key" button</li>
              <li>Give your key a name (e.g., "Business OS")</li>
              <li>Copy the key (starts with <code className="bg-muted px-1 rounded">sk-ant-...</code>)</li>
              <li>Paste it into the Anthropic API Key field above</li>
            </ol>
            <div className="bg-muted p-3 rounded text-xs space-y-1">
              <p className="font-medium">💡 Tips:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Claude Sonnet 4 is recommended (good balance of quality and speed)</li>
                <li>Pricing: ~$3 per million input tokens, ~$15 per million output tokens</li>
                <li>Free tier includes $5 credit to start</li>
              </ul>
            </div>
          </div>

          {/* OpenAI */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">OpenAI (ChatGPT)</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('https://platform.openai.com/api-keys', '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open Platform
              </Button>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Go to <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">platform.openai.com/api-keys</a></li>
              <li>Sign in with your OpenAI account</li>
              <li>Click "Create new secret key"</li>
              <li>Give it a name (e.g., "Business OS")</li>
              <li>Copy the key (starts with <code className="bg-muted px-1 rounded">sk-...</code>)</li>
              <li>Paste it into the OpenAI API Key field above</li>
            </ol>
            <div className="bg-muted p-3 rounded text-xs space-y-1">
              <p className="font-medium">💡 Tips:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>GPT-4 Turbo recommended for best results</li>
                <li>Pricing: ~$10 per million input tokens, ~$30 per million output tokens</li>
                <li>Requires payment method on file</li>
              </ul>
            </div>
          </div>

          {/* Google (Gemini) */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Google (Gemini)</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open('https://aistudio.google.com/app/apikey', '_blank')}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open AI Studio
              </Button>
            </div>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Go to <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">aistudio.google.com/app/apikey</a></li>
              <li>Sign in with your Google account</li>
              <li>Click "Create API Key"</li>
              <li>Select an existing Google Cloud project or create a new one</li>
              <li>Copy the API key</li>
              <li>Paste it into the Google API Key field above</li>
            </ol>
            <div className="bg-muted p-3 rounded text-xs space-y-1">
              <p className="font-medium">💡 Tips:</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Gemini 1.5 Flash is fast and cost-effective</li>
                <li>Free tier: 15 requests per minute, 1500 per day</li>
                <li>Paid tier available through Google Cloud</li>
              </ul>
            </div>
          </div>

          {/* Security Notice */}
          <div className="border-l-4 border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded">
            <p className="font-medium text-sm mb-2">🔒 Security Notice</p>
            <ul className="text-xs space-y-1 list-disc list-inside">
              <li>API keys are stored locally in your browser (localStorage)</li>
              <li>Keys are never sent to any server except the AI provider</li>
              <li>In production, keys will be stored in your OS keychain</li>
              <li>Never share your API keys with anyone</li>
              <li>You can revoke keys anytime from the provider's console</li>
            </ul>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <Button onClick={() => onOpenChange(false)}>
            Got it!
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
