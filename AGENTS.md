# cursor better feedback
由于cursor自带的ask question功能容易受到网络波动，所以考虑仔细实现一个更好的feedback工具以实现用户与agent的交流。后续统称为“feedback”

## 注意事项
1. 项目实现要近可能鲁棒，不需要有复杂的功能，只需要把交互这一核心功能做好即可
2. 项目的实现方式目前技术路线：MCP APP+降级处理
3. 与winsurf类似，用户目前的cursor pro仍是按次计费，所以需要这种feedback工具，但是cursor的封禁或者限制策略不太明确，你可以查阅cursor官方文档：https://cursor.com/cn/docs，或者cursor官方社区：https://forum.cursor.com/ 来获取相关信息
4. 开发MCP APP是注意使用create-mcp-app等技能。MCP的官方说明文档位于docs/MCP-APP.md中。

## 用户需求
1. 在agent碰到问题或者完成阶段性任务时能够调用feedback进行反馈
2. 需要考虑远程开发，用户可能通过ssh进行远程开发或者连接wsl开发
3. 需要考虑多窗口，例如在wsl环境中，用户可能开多个窗口进行开发（如果实现有难度，每个工作区可仅限单窗口单agent聊天，如果能做到同一工作区多agent同时反馈更好）
4. 鲁棒性高、易安装。尤其是受网络波动的影响要小