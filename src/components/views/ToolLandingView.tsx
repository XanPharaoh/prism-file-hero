import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getToolById } from '../../registry/toolRegistry';
import type { ToolID } from '../../types';
import { SEOHelmet } from '../seo/SEOHelmet';
import { useAppStore } from '../../store/appStore';

export const ToolLandingView: React.FC = () => {
  const { toolId } = useParams<{ toolId: string }>();
  const navigate = useNavigate();
  const setSelectedTool = useAppStore((s) => s.setSelectedTool);

  const tool = toolId ? getToolById(toolId as ToolID) : undefined;

  if (!tool) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <h1 className="text-4xl font-black text-slate-900 mb-4">Tool Not Found</h1>
          <p className="text-slate-600 mb-8">The requested tool could not be found.</p>
          <button
            onClick={() => navigate('/app')}
            className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const canonicalUrl = `${window.location.origin}/tools/${toolId}`;
  const seoTitle = `Free Online ${tool.name} Tool - ${tool.description} | Prism File Hero`;
  const seoDescription = `Use our free online ${tool.name.toLowerCase()} tool to ${tool.description.toLowerCase()}. Fast, secure, and runs locally in your browser. No uploads to external servers.`;

  const handleUseTool = () => {
    if (toolId) {
      setSelectedTool(toolId as ToolID);
      navigate('/app');
    }
  };

  const howItWorksText = `
    Our ${tool.name.toLowerCase()} tool is designed to process your documents directly in your browser using modern web technologies.
    When you upload a file, it is processed locally on your device or on secure edge servers, ensuring your sensitive data never leaves your control.
    We use industry-standard encryption and processing libraries to maintain the highest levels of security and accuracy.
    The tool is completely free for personal use, with optional premium plans available for power users and businesses.
    All processing happens in real-time, giving you instant results without waiting for uploads or downloads from remote servers.
    Your privacy is our priority: we do not store, share, or analyze your documents beyond the processing session.
  `.trim();

  return (
    <>
      <SEOHelmet
        title={seoTitle}
        description={seoDescription}
        canonicalUrl={canonicalUrl}
        structuredData={{
          '@type': 'HowTo',
          name: `How to use ${tool.name}`,
          step: [
            { '@type': 'HowToStep', name: 'Upload your document', text: 'Select or drag-and-drop your PDF file into the upload area.' },
            { '@type': 'HowToStep', name: 'Configure options', text: 'Adjust any tool-specific settings to match your requirements.' },
            { '@type': 'HowToStep', name: 'Process', text: 'Click the process button and wait for the AI-powered engine to complete the task.' },
            { '@type': 'HowToStep', name: 'Download result', text: 'Download the processed file instantly to your device.' },
          ],
        }}
      />

      <div className="min-h-screen bg-slate-50">
        {/* Hero Section */}
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-6 py-16 text-center">
            <h1 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">
              Free Online {tool.name} Tool
            </h1>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto mb-8">
              {tool.description}. Fast, secure, and 100% free. Your files never leave your browser.
            </p>
            <button
              onClick={handleUseTool}
              className="px-8 py-4 bg-indigo-600 text-white text-lg font-bold rounded-2xl hover:bg-indigo-700 shadow-lg hover:shadow-xl transition-all"
            >
              Use {tool.name} Now — It's Free
            </button>
          </div>
        </div>

        {/* How It Works */}
        <div className="max-w-7xl mx-auto px-6 py-16">
          <h2 className="text-3xl font-black text-slate-900 mb-12 text-center">
            How Our {tool.name} Tool Works
          </h2>
          <div className="max-w-4xl mx-auto">
            <p className="text-lg text-slate-700 leading-relaxed mb-8">
              {howItWorksText}
            </p>
            <p className="text-lg text-slate-700 leading-relaxed">
              Prism File Hero is the most reliable document processing platform for professionals and everyday users alike.
              Our mission is to democratize access to powerful document tools formerly available only in expensive desktop software suites.
              Every PDF utility we provide is optimized for speed, accuracy, and user privacy.
              Backed by NVIDIA NIM AI for state-of-the-art document recognition and extraction capabilities.
            </p>
          </div>
        </div>

        {/* Technical Advantages */}
        <div className="bg-white border-t border-slate-200">
          <div className="max-w-7xl mx-auto px-6 py-16">
            <h2 className="text-3xl font-black text-slate-900 mb-12 text-center">
              Why Choose Prism File Hero?
            </h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="p-6 rounded-2xl border border-slate-200">
                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Bank-Grade Security</h3>
                <p className="text-slate-600">All processing runs locally or on encrypted edge servers. We never store your documents.</p>
              </div>
              <div className="p-6 rounded-2xl border border-slate-200">
                <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Lightning Fast</h3>
                <p className="text-slate-600">Optimized algorithms and edge computing deliver results in seconds, not minutes.</p>
              </div>
              <div className="p-6 rounded-2xl border border-slate-200">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">No Software Install</h3>
                <p className="text-slate-600">Works entirely in your browser. No downloads, no installations, no compatibility issues.</p>
              </div>
            </div>
          </div>
        </div>

        {/* CTA Section */}
        <div className="bg-indigo-600">
          <div className="max-w-7xl mx-auto px-6 py-16 text-center">
            <h2 className="text-3xl font-black text-white mb-6">
              Ready to get started?
            </h2>
            <p className="text-xl text-indigo-100 mb-8 max-w-2xl mx-auto">
              Join thousands of users who trust Prism File Hero for their document processing needs.
            </p>
            <button
              onClick={handleUseTool}
              className="px-8 py-4 bg-white text-indigo-600 text-lg font-bold rounded-2xl hover:bg-indigo-50 shadow-lg transition-all"
            >
              Start Using {tool.name} Now
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-900 text-slate-400">
          <div className="max-w-7xl mx-auto px-6 py-8 text-center text-sm">
            <p>&copy; {new Date().getFullYear()} Prism File Hero. All rights reserved.</p>
          </div>
        </div>
      </div>
    </>
  );
};