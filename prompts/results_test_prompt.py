T1 = """- Index: 1; Operation: 点击屏幕底部任务栏中的Chrome浏览器图标，打开浏览器；Target: Chrome浏览器图标，位于屏幕底部任务栏，图标为圆形，外圈由红、黄、绿三色组成，内圈为蓝色圆形；Orientation: 屏幕底部任务栏；Condition: Chrome浏览器窗口成功打开并显示Google搜索页面；Think: 观察到屏幕底部任务栏中Chrome图标被点击，结合后续显示的Google搜索页面，判定此操作为启动Chrome浏览器；
- Index: 2; Operation: 点击Google搜索页面中的搜索框，准备输入搜索内容；Target: Google搜索框，位于页面中央，显示“在 Google 中搜索或输入网址”的提示文字，带有放大镜图标；Orientation: 页面中央；Condition: 搜索框获得焦点，光标定位在搜索框内；Think: 视频中显示Google页面，用户点击了搜索框区域，搜索框呈现可输入状态，故判定为点击搜索框操作；
- Index: 3; Operation: 在Google搜索框中输入“哔哩哔哩”文本内容；Target: Google搜索框，已获得焦点，显示输入光标；Orientation: 页面中央；Condition: 搜索框中显示“哔哩哔哩”文本内容；Think: 观察到搜索框内出现“哔哩哔哩”文字，结合操作时序，判定为在搜索框中输入该文本；
- Index: 4; Operation: 点击Google搜索框右侧的搜索按钮，执行搜索操作；Target: 搜索按钮，位于搜索框右侧，显示放大镜图标；Orientation: 页面中央搜索框右侧；Condition: 页面跳转至Google搜索结果页面，显示“哔哩哔哩”相关搜索结果；Think: 搜索框输入完成后，点击搜索按钮是执行搜索的标准操作，后续页面显示搜索结果，验证了此操作；
- Index: 5; Operation: 点击Google搜索结果中的“哔哩哔哩(°-°)つ口干杯~-bilibili”链接，进入哔哩哔哩网站；Target: 搜索结果链接，显示为紫色文字，包含“哔哩哔哩(°-°)つ口干杯~-bilibili”内容；Orientation: 搜索结果页面中部；Condition: 页面跳转至哔哩哔哩网站首页；Think: 搜索结果中该链接与目标网站匹配，点击后页面跳转至bilibili.com，判定为点击该链接操作；
- Index: 6; Operation: 点击哔哩哔哩网站首页右上角的“登录”按钮，打开登录弹窗；Target: 登录按钮，位于页面右上角，显示“登录”文字，背景为蓝色；Orientation: 页面右上角；Condition: 登录弹窗成功弹出，显示登录选项；Think: 哔哩哔哩首页右上角有明显的登录按钮，点击后弹出登录界面，符合操作逻辑；
- Index: 7; Operation: 点击登录弹窗中的“密码登录”选项卡，切换至密码登录界面；Target: 密码登录选项卡，位于登录弹窗顶部，显示“密码登录”文字；Orientation: 登录弹窗顶部；Condition: 登录弹窗切换至密码登录界面，显示账号、密码输入框；Think: 登录弹窗默认可能显示其他登录方式，点击“密码登录”切换到对应界面，后续显示账号密码输入框，验证了此操作；
- Index: 8; Operation: 在密码登录界面的“账号”输入框中输入“123321”；Target: 账号输入框，位于密码登录界面，显示“请输入账号”的提示文字；Orientation: 登录弹窗中部；Condition: 账号输入框中显示“123321”文本内容；Think: 观察到账号输入框内出现“123321”文字，结合操作时序，判定为在该输入框中输入账号；
- Index: 9; Operation: 点击登录弹窗右上角的关闭按钮，关闭登录弹窗；Target: 关闭按钮，位于登录弹窗右上角，显示“×”符号；Orientation: 登录弹窗右上角；Condition: 登录弹窗成功关闭，页面恢复至哔哩哔哩首页；Think: 登录弹窗右上角有关闭按钮，点击后弹窗消失，页面回到首页，判定为关闭登录弹窗操作。
"""

T2 = """- Index: 1; Operation: 点击屏幕底部任务栏中的Google Chrome图标，启动浏览器；Target: Google Chrome应用图标（位于屏幕底部任务栏，呈圆形，包含红、黄、绿、蓝四色）；Orientation: 屏幕底部任务栏；Condition: Google Chrome浏览器窗口成功打开并显示新标签页；Think: 根据用户指令“打开谷歌浏览器”，需启动浏览器，屏幕底部任务栏中存在Google Chrome图标，点击该图标可启动浏览器。
- Index: 2; Operation: 在浏览器地址栏中输入网址“bilibili.com”；Target: 浏览器地址栏（位于浏览器窗口顶部，显示为可输入文本的白色输入框，当前显示“G”字样）；Orientation: 浏览器窗口顶部；Condition: 地址栏中成功输入“bilibili.com”文本；Think: 根据用户指令“在地址栏上输入bilibili.com”，需在地址栏中输入指定网址，地址栏是浏览器中用于输入网址的输入框，当前已显示且可交互。
- Index: 3; Operation: 按下回车键，提交地址栏中的网址请求；Target: 浏览器地址栏（已输入“bilibili.com”文本的输入框）；Orientation: 浏览器窗口顶部；Condition: 浏览器开始加载bilibili网站页面；Think: 输入网址后需提交请求以访问网站，回车键是常用的提交操作，地址栏中已输入目标网址，按下回车键可触发页面加载。
- Index: 4; Operation: 点击页面右上角的登录头像按钮；Target: 登录头像按钮（位于bilibili页面右上角，显示为圆形头像图标，旁边有“登录”文字）；Orientation: 页面右上角；Condition: 登录弹窗成功弹出；Think: 根据用户指令“点击这个登录的头像”，需点击登录入口，页面右上角的登录头像按钮是登录功能的入口，点击后可弹出登录界面。
- Index: 5; Operation: 点击登录弹窗中的“账号”输入框；Target: 账号输入框（位于登录弹窗中，显示为“请输入账号”的文本输入框）；Orientation: 登录弹窗中部；Condition: 账号输入框获得焦点，光标定位在输入框内；Think: 根据用户指令“输入账号”，需先激活账号输入框，登录弹窗中的“账号”输入框是用于输入账号的元素，点击后可进入输入状态。
- Index: 1; Operation: 点击登录弹窗右上角的关闭按钮，关闭登录弹窗；Target: 登录弹窗右上角的“×”关闭按钮，白色背景、黑色“×”符号；Orientation: 右上；Condition: 登录弹窗消失，页面恢复至bilibili首页主界面状态；Think: 根据视频画面，登录弹窗右上角有明显的“×”关闭按钮，点击后弹窗消失，符合用户“点击关闭”的操作描述。
"""