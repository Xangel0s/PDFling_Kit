const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: {
    popup: "./src/popup/popup.ts",
    workspace: "./src/workspace/workspace.ts",
    "service-worker": "./src/background/service-worker.ts"
  },
  output: {
    filename: "[name].js",
    path: path.resolve(__dirname, "dist"),
    clean: true
  },
  resolve: {
    extensions: [".ts", ".js"]
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: "ts-loader",
        exclude: /node_modules/
      }
    ]
  },
  devtool: "source-map",
  optimization: {
    splitChunks: false,
    runtimeChunk: false
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: "manifest.json", to: "manifest.json" },
        { from: "src/popup/popup.html", to: "popup.html" },
        { from: "src/popup/popup.css", to: "popup.css" },
        { from: "src/workspace/workspace.html", to: "workspace.html" },
        { from: "src/workspace/workspace.css", to: "workspace.css" },
        {
          from: "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
          to: "pdf.worker.min.mjs"
        }
      ]
    })
  ]
};