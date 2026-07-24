import {
  Play, MousePointer2, MousePointerClick, Type, Keyboard, Scroll, Hand,
  Search, CheckCircle,
  Clock, Timer,
  Variable, GitBranch, Repeat, FileText, Flag, StopCircle,
} from 'lucide-react';

export type NodeCategory = 'control' | 'ai-action' | 'ai-query' | 'wait';

export interface PropertyField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'select' | 'switch' | 'variable' | 'key-select';
  description?: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  sensitive?: boolean;
}

export interface NodeConfig {
  type: string;
  name: string;
  category: NodeCategory;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  color: string;
  defaultParams: Record<string, unknown>;
  propertyFields: PropertyField[];
}

export const nodeConfigs: NodeConfig[] = [
  // ====== 控制流 ======
  {
    type: 'control.start',
    name: '开始',
    category: 'control',
    icon: Flag,
    description: '工作流的起点，执行从这里开始',
    color: '#22c55e',
    defaultParams: {},
    propertyFields: [],
  },
  {
    type: 'control.end',
    name: '结束',
    category: 'control',
    icon: StopCircle,
    description: '工作流的终点，执行到这里结束',
    color: '#ef4444',
    defaultParams: {
      message: '',
    },
    propertyFields: [
      { key: 'message', label: '输出内容', type: 'textarea', description: '输入 # 选择变量插入到内容中' },
    ],
  },
  {
    type: 'control.if',
    name: '条件判断',
    category: 'control',
    icon: GitBranch,
    description: '根据条件决定走哪条分支',
    color: '#3b82f6',
    defaultParams: {
      leftVar: '',
      operator: '==',
      rightValue: '',
    },
    propertyFields: [
      { key: 'leftVar', label: '左侧变量', type: 'variable', placeholder: '选择变量' },
      {
        key: 'operator',
        label: '比较符',
        type: 'select',
        options: [
          { label: '等于 (==)', value: '==' },
          { label: '不等于 (!=)', value: '!=' },
          { label: '大于 (>)', value: '>' },
          { label: '小于 (<)', value: '<' },
          { label: '大于等于 (>=)', value: '>=' },
          { label: '小于等于 (<=)', value: '<=' },
        ],
        defaultValue: '==',
      },
      { key: 'rightValue', label: '右侧值', type: 'text', description: '输入 # 选择变量，或直接写固定值' },
    ],
  },
  {
    type: 'control.loop',
    name: '循环',
    category: 'control',
    icon: Repeat,
    description: '重复执行一段流程',
    color: '#f59e0b',
    defaultParams: {
      loopType: 'for',
      from: 1,
      to: 5,
      step: 1,
      iteratorVar: 'i',
      maxIterations: 100,
      condition: '',
      arrayVar: '',
      itemVar: 'item',
      bodyNodeId: '',
    },
    propertyFields: [
      {
        key: 'loopType',
        label: '循环类型',
        type: 'select',
        options: [
          { label: 'for 循环', value: 'for' },
          { label: 'while 循环', value: 'while' },
          { label: 'forEach 遍历', value: 'forEach' },
        ],
        defaultValue: 'for',
      },
      { key: 'from', label: '起始值', type: 'number', defaultValue: 1 },
      { key: 'to', label: '结束值', type: 'number', defaultValue: 5 },
      { key: 'step', label: '步长', type: 'number', defaultValue: 1 },
      { key: 'iteratorVar', label: '迭代变量名', type: 'text', defaultValue: 'i' },
      { key: 'maxIterations', label: '最大迭代次数', type: 'number', defaultValue: 100 },
    ],
  },
  {
    type: 'control.var',
    name: '变量赋值',
    category: 'control',
    icon: Variable,
    description: '给变量赋值或进行运算',
    color: '#8b5cf6',
    defaultParams: {
      varName: '',
      operation: 'set',
      value: '',
      valueType: 'string',
    },
    propertyFields: [
      { key: 'varName', label: '变量名', type: 'text', placeholder: '例如: result' },
      {
        key: 'operation',
        label: '操作类型',
        type: 'select',
        options: [
          { label: '赋值 (=)', value: 'set' },
          { label: '递增 (+)', value: 'increment' },
          { label: '递减 (-)', value: 'decrement' },
          { label: '乘法 (*)', value: 'multiply' },
          { label: '除法 (/)', value: 'divide' },
          { label: '字符串拼接', value: 'concat' },
          { label: '转大写', value: 'toUpperCase' },
          { label: '转小写', value: 'toLowerCase' },
          { label: '去除首尾空格', value: 'trim' },
          { label: '取整', value: 'toInteger' },
        ],
        defaultValue: 'set',
      },
      {
        key: 'valueType',
        label: '值类型',
        type: 'select',
        options: [
          { label: '字符串', value: 'string' },
          { label: '数字', value: 'number' },
          { label: '布尔值', value: 'boolean' },
          { label: '表达式', value: 'expression' },
        ],
        defaultValue: 'string',
        description: '赋值或运算时使用的值类型',
      },
      { key: 'value', label: '值', type: 'textarea', description: '输入 # 选择变量；转大写/小写/trim/取整操作不需要填值' },
    ],
  },
  {
    type: 'control.log',
    name: '日志输出',
    category: 'control',
    icon: FileText,
    description: '打印日志或变量值',
    color: '#8b5cf6',
    defaultParams: {
      message: '',
      level: 'info',
    },
    propertyFields: [
      { key: 'message', label: '日志内容', type: 'textarea', description: '输入 # 选择变量插入到内容中' },
      {
        key: 'level',
        label: '日志级别',
        type: 'select',
        options: [
          { label: '信息 (info)', value: 'info' },
          { label: '警告 (warn)', value: 'warn' },
          { label: '错误 (error)', value: 'error' },
        ],
        defaultValue: 'info',
      },
    ],
  },

  // ====== AI 操作 ======
  {
    type: 'midscene.act',
    name: 'AI 操作',
    category: 'ai-action',
    icon: Play,
    description: 'AI 自动规划并执行复杂操作',
    color: '#06b6d4',
    defaultParams: {
      prompt: '',
      deepThink: false,
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'prompt', label: '操作描述', type: 'textarea', placeholder: '例如：打开设置菜单' },
      { key: 'deepThink', label: '深度思考', type: 'switch', description: '引导 AI 注重任务拆解' },
      { key: 'deepLocate', label: '深度定位', type: 'switch', description: '更精准地定位 UI 元素' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },
  {
    type: 'midscene.tap',
    name: '点击元素',
    category: 'ai-action',
    icon: MousePointerClick,
    description: '点击指定的元素',
    color: '#06b6d4',
    defaultParams: {
      target: '',
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'target', label: '目标描述', type: 'text', placeholder: '例如：确认按钮' },
      { key: 'deepLocate', label: '深度定位', type: 'switch' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },
  {
    type: 'midscene.doubleClick',
    name: '双击元素',
    category: 'ai-action',
    icon: MousePointer2,
    description: '双击指定的元素',
    color: '#06b6d4',
    defaultParams: {
      target: '',
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'target', label: '目标描述', type: 'text', placeholder: '例如：文件图标' },
      { key: 'deepLocate', label: '深度定位', type: 'switch' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },
  {
    type: 'midscene.rightClick',
    name: '右键元素',
    category: 'ai-action',
    icon: MousePointer2,
    description: '右键点击指定的元素',
    color: '#06b6d4',
    defaultParams: {
      target: '',
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'target', label: '目标描述', type: 'text', placeholder: '例如：文件' },
      { key: 'deepLocate', label: '深度定位', type: 'switch' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },
  {
    type: 'midscene.hover',
    name: '悬停元素',
    category: 'ai-action',
    icon: Hand,
    description: '鼠标悬停在指定元素上',
    color: '#06b6d4',
    defaultParams: {
      target: '',
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'target', label: '目标描述', type: 'text', placeholder: '例如：下拉菜单' },
      { key: 'deepLocate', label: '深度定位', type: 'switch' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },
  {
    type: 'midscene.input',
    name: '输入文本',
    category: 'ai-action',
    icon: Type,
    description: '在指定元素中输入文本',
    color: '#06b6d4',
    defaultParams: {
      target: '',
      value: '',
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'target', label: '目标描述', type: 'text', placeholder: '例如：搜索框' },
      { key: 'value', label: '输入内容', type: 'text' },
      { key: 'deepLocate', label: '深度定位', type: 'switch' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },
  {
    type: 'midscene.clearInput',
    name: '清空输入',
    category: 'ai-action',
    icon: Type,
    description: '清空输入框中的文本',
    color: '#06b6d4',
    defaultParams: {
      target: '',
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'target', label: '目标描述', type: 'text', placeholder: '例如：搜索框' },
      { key: 'deepLocate', label: '深度定位', type: 'switch' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },
  {
    type: 'midscene.keyboardPress',
    name: '按键',
    category: 'ai-action',
    icon: Keyboard,
    description: '在指定元素上按下按键',
    color: '#06b6d4',
    defaultParams: {
      target: '',
      keyName: 'Enter',
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'target', label: '目标描述', type: 'text', placeholder: '例如：输入框' },
      { key: 'keyName', label: '按键', type: 'key-select', defaultValue: 'Enter', description: '选择要按下的按键' },
      { key: 'deepLocate', label: '深度定位', type: 'switch' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },
  {
    type: 'midscene.scroll',
    name: '滚动',
    category: 'ai-action',
    icon: Scroll,
    description: '滚动页面或指定元素',
    color: '#06b6d4',
    defaultParams: {
      target: '',
      scrollType: 'singleAction',
      direction: 'down',
      distance: 300,
      deepLocate: false,
      cacheable: true,
    },
    propertyFields: [
      { key: 'target', label: '目标描述', type: 'text', placeholder: '留空则滚动页面' },
      {
        key: 'scrollType',
        label: '滚动类型',
        type: 'select',
        options: [
          { label: '单次滚动', value: 'singleAction' },
          { label: '滚动到底部', value: 'scrollToBottom' },
          { label: '滚动到顶部', value: 'scrollToTop' },
        ],
        defaultValue: 'singleAction',
      },
      {
        key: 'direction',
        label: '滚动方向',
        type: 'select',
        options: [
          { label: '向下', value: 'down' },
          { label: '向上', value: 'up' },
          { label: '向左', value: 'left' },
          { label: '向右', value: 'right' },
        ],
        defaultValue: 'down',
      },
      { key: 'distance', label: '滚动距离(px)', type: 'number', defaultValue: 300 },
      { key: 'deepLocate', label: '深度定位', type: 'switch' },
      { key: 'cacheable', label: '启用缓存', type: 'switch', defaultValue: true },
    ],
  },

  // ====== AI 查询 ======
  {
    type: 'midscene.query',
    name: 'AI 查询',
    category: 'ai-query',
    icon: Search,
    description: '查询页面内容并保存为变量',
    color: '#ec4899',
    defaultParams: {
      prompt: '',
      outputVar: '',
    },
    propertyFields: [
      { key: 'prompt', label: '查询描述', type: 'textarea', placeholder: '例如：获取页面上所有的标题' },
      { key: 'outputVar', label: '输出变量名', type: 'text', description: '查询结果保存到这个变量，后续节点可通过 # 引用' },
    ],
  },
  {
    type: 'midscene.assert',
    name: 'AI 断言',
    category: 'ai-query',
    icon: CheckCircle,
    description: '断言页面状态是否符合预期',
    color: '#ec4899',
    defaultParams: {
      prompt: '',
      errorMessage: '',
    },
    propertyFields: [
      { key: 'prompt', label: '断言描述', type: 'textarea', placeholder: '例如：页面应该显示登录成功' },
      { key: 'errorMessage', label: '失败提示', type: 'text', description: '断言失败时显示的错误信息' },
    ],
  },

  // ====== 等待 ======
  {
    type: 'midscene.waitFor',
    name: '等待条件',
    category: 'wait',
    icon: Clock,
    description: '等待某个条件满足',
    color: '#10b981',
    defaultParams: {
      prompt: '',
      timeout: 30000,
    },
    propertyFields: [
      { key: 'prompt', label: '等待条件', type: 'text', placeholder: '例如：页面加载完成' },
      { key: 'timeout', label: '超时时间(ms)', type: 'number', defaultValue: 30000 },
    ],
  },
  {
    type: 'midscene.sleep',
    name: '等待时间',
    category: 'wait',
    icon: Timer,
    description: '等待指定的毫秒数',
    color: '#10b981',
    defaultParams: {
      duration: 1000,
    },
    propertyFields: [
      { key: 'duration', label: '等待时间(ms)', type: 'number', defaultValue: 1000 },
    ],
  },
];

export const categoryLabels: Record<NodeCategory, string> = {
  control: '控制流',
  'ai-action': 'AI 操作',
  'ai-query': 'AI 查询',
  wait: '等待',
};

export const getNodeConfig = (type: string): NodeConfig | undefined => {
  return nodeConfigs.find((c) => c.type === type);
};
