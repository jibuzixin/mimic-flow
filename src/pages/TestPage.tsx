export default function TestPage() {
  console.log('[TestPage] Rendering...');
  return (
    <div className="h-full w-full bg-blue-100 flex items-center justify-center">
      <div className="bg-white p-8 rounded-xl shadow-lg">
        <h1 className="text-2xl font-bold text-gray-800">测试页面</h1>
        <p className="text-gray-600 mt-4">如果能看到这个页面，说明路由正常</p>
      </div>
    </div>
  );
}
