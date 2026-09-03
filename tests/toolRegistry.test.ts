import { describe, it, expect } from 'vitest';
import { TOOL_REGISTRY, getToolById, getToolsByCategory } from '../src/registry/toolRegistry';
import type { ToolID, ToolCategory } from '../src/types';
import { TOOL_COSTS, isAiTool } from '../services/usageConfig';

describe('Tool Registry', () => {
  it('should have all 37 tools registered', () => {
    expect(TOOL_REGISTRY.length).toBe(37);
  });

  it('keeps usage configuration limited to registered UI tools', () => {
    expect(Object.keys(TOOL_COSTS).sort()).toEqual(
      TOOL_REGISTRY.map((tool) => tool.id).sort(),
    );
  });

  it('meters PDF to Excel as an AI tool because its recovery path calls the AI worker', () => {
    expect(isAiTool('pdf-to-excel')).toBe(true);
    expect(TOOL_COSTS['pdf-to-excel']).toMatchObject({
      category: 'ai',
      featureType: 'ai',
      aiPagesPerPage: 1,
      operationCost: 0,
    });
  });

  it('should have unique tool IDs', () => {
    const ids = TOOL_REGISTRY.map(t => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(TOOL_REGISTRY.length);
  });

  it('every tool should have a valid handler function', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.handler).toBeDefined();
      expect(typeof tool.handler).toBe('function');
    }
  });

  it('every tool should have required fields', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.id).toBeDefined();
      expect(tool.category).toBeDefined();
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.icon).toBeDefined();
      expect(tool.color).toBeDefined();
      expect(typeof tool.requiresAuth).toBe('boolean');
      expect(Array.isArray(tool.allowedFileTypes)).toBe(true);
      expect(typeof tool.maxFiles).toBe('number');
      expect(typeof tool.supportsBatchProcessing).toBe('boolean');
    }
  });

  it('every tool should have valid allowedFileTypes', () => {
    for (const tool of TOOL_REGISTRY) {
      expect(tool.allowedFileTypes.length).toBeGreaterThan(0);
      for (const fileType of tool.allowedFileTypes) {
        expect(typeof fileType).toBe('string');
        expect(fileType.length).toBeGreaterThan(0);
      }
    }
  });

  it('getToolById should return correct tool', () => {
    const mergeTool = getToolById('merge');
    expect(mergeTool).toBeDefined();
    expect(mergeTool?.id).toBe('merge');
    expect(mergeTool?.name).toBe('Merge PDF');
    expect(mergeTool?.category).toBe('Organize');
  });

  it('getToolById should return undefined for invalid ID', () => {
    const result = getToolById('invalid-tool' as ToolID);
    expect(result).toBeUndefined();
  });

  it('getToolsByCategory should filter correctly', () => {
    const organizeTools = getToolsByCategory('Organize');
    expect(organizeTools.length).toBeGreaterThan(0);
    for (const tool of organizeTools) {
      expect(tool.category).toBe('Organize');
    }
  });

  it('getToolsByCategory with "All" should return all tools', () => {
    const allTools = getToolsByCategory('All');
    expect(allTools.length).toBe(TOOL_REGISTRY.length);
  });

  it('AI Labs tools should require auth', () => {
    for (const tool of TOOL_REGISTRY) {
      if (tool.category === 'AI Labs') {
        expect(tool.requiresAuth).toBe(true);
      }
    }
  });

  it('should have tools in each category', () => {
    const categories: ToolCategory[] = ['Organize', 'Optimize', 'Convert', 'Security', 'AI Labs'];
    for (const category of categories) {
      const tools = getToolsByCategory(category);
      expect(tools.length).toBeGreaterThan(0);
    }
  });

  it('handlers should use dynamic imports for code splitting', () => {
    // Verify the handler function toString contains dynamic import usage
    for (const tool of TOOL_REGISTRY) {
      const handlerStr = tool.handler.toString();
      expect(handlerStr).toContain('import');
    }
  });

  it('allowedFileTypes should be consistent with tool purpose', () => {
    const pdfTools = ['merge', 'split', 'compress', 'pdf-to-word', 'pdf-to-excel', 'pdf-to-jpg',
      'protect', 'redact', 'watermark', 'ocr', 'compare', 'rotate', 'ocr-to-md', 'grammar-check'];
    const imageTool = 'jpg-to-pdf';

    for (const toolId of pdfTools) {
      const tool = getToolById(toolId as ToolID);
      expect(tool?.allowedFileTypes).toContain('application/pdf');
    }

    const jpgTool = getToolById(imageTool as ToolID);
    expect(jpgTool?.allowedFileTypes).toContain('image/jpeg');
    expect(jpgTool?.allowedFileTypes).toContain('image/png');
  });
});
