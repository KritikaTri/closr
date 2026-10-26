import UIKit
import Capacitor
import GoogleSignIn
import Photos

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ClosrBridgeViewController()
        window?.makeKeyAndVisible()

        if let url = connectionOptions.urlContexts.first?.url,
           GIDSignIn.sharedInstance.handle(url) {
            return
        }
        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        if let url = URLContexts.first?.url, GIDSignIn.sharedInstance.handle(url) {
            return
        }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

class ClosrBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(ClosrPhotoLibraryPlugin())
    }
}

// Read-only, on-demand gallery access. No asset is uploaded by native code.
@objc(ClosrPhotoLibraryPlugin)
public class ClosrPhotoLibraryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ClosrPhotoLibraryPlugin"
    public let jsName = "ClosrPhotoLibrary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "preview", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "closr.photo-preview", qos: .userInitiated)
    private var allowedIds = Set<String>()

    @objc func preview(_ call: CAPPluginCall) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        guard let from = call.getString("from"), let to = call.getString("to"),
              let start = formatter.date(from: from), let last = formatter.date(from: to),
              last >= start, last.timeIntervalSince(start) <= 366 * 86400,
              let end = Calendar.current.date(byAdding: .day, value: 1, to: last) else {
            call.reject("Choose a valid date range of up to one year."); return
        }
        let load: (PHAuthorizationStatus) -> Void = { status in
            guard status == .authorized || status == .limited else {
                call.reject("Photo access wasn’t allowed. You can still use Choose photos."); return
            }
            self.queue.async {
                let options = PHFetchOptions()
                let favourites = call.getBool("favouritesOnly") ?? false
                options.predicate = NSPredicate(format: "mediaType == %d AND creationDate >= %@ AND creationDate < %@ AND hidden == NO" + (favourites ? " AND favorite == YES" : ""), PHAssetMediaType.image.rawValue, start as NSDate, end as NSDate)
                options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
                options.fetchLimit = 121
                let assets = PHAsset.fetchAssets(with: options)
                var items = [[String: Any]]()
                self.allowedIds.removeAll()
                for index in 0..<min(120, assets.count) {
                    let asset = assets.object(at: index)
                    self.allowedIds.insert(asset.localIdentifier)
                    var item: [String: Any] = ["id": asset.localIdentifier, "date": formatter.string(from: asset.creationDate ?? start), "favourite": asset.isFavorite, "width": asset.pixelWidth, "height": asset.pixelHeight]
                    if let image = self.image(asset, size: 160, network: false), let bytes = image.jpegData(compressionQuality: 0.6) {
                        item["thumbnail"] = "data:image/jpeg;base64," + bytes.base64EncodedString()
                    }
                    items.append(item)
                }
                call.resolve(["items": items, "limited": status == .limited, "hasMore": assets.count > 120])
            }
        }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .notDetermined {
            DispatchQueue.main.async { PHPhotoLibrary.requestAuthorization(for: .readWrite, handler: load) }
        } else { load(status) }
    }

    private func image(_ asset: PHAsset, size: CGFloat, network: Bool) -> UIImage? {
        let options = PHImageRequestOptions()
        options.isSynchronous = true
        options.isNetworkAccessAllowed = network
        options.deliveryMode = .highQualityFormat
        options.resizeMode = .exact
        var result: UIImage?
        PHImageManager.default().requestImage(for: asset, targetSize: CGSize(width: size, height: size), contentMode: .aspectFit, options: options) { image, _ in result = image }
        return result
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("Choose a photo from the preview."); return }
        queue.async {
            guard self.allowedIds.contains(id), let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject,
                  let image = self.image(asset, size: 1400, network: true), let bytes = image.jpegData(compressionQuality: 0.78) else {
                call.reject("This photo could not be loaded. Preview your selection again or use Choose photos."); return
            }
            call.resolve(["dataUrl": "data:image/jpeg;base64," + bytes.base64EncodedString()])
        }
    }
}
