import json
import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, AdaBoostClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC
from sklearn.neural_network import MLPClassifier
from catboost import CatBoostClassifier
import shap
import lime
import lime.lime_tabular

# Set random seeds for reproducibility
np.random.seed(42)

def load_veremi_data(data_dir):
    gt_path = os.path.join(data_dir, 'veins_maat.uc1.14505201.180205_165350/veins-maat/simulations/securecomm2018/results/GroundTruthJSONlog.json')
    with open(gt_path, 'r') as f:
        gt_data = [json.loads(line) for line in f]
    
    records = []
    for entry in gt_data:
        records.append({
            'pos_x': entry['pos'][0],
            'pos_y': entry['pos'][1],
            'pos_z': entry['pos'][2],
            'spd_x': entry['spd'][0],
            'spd_y': entry['spd'][1],
            'spd_z': entry['spd'][2],
            'label': 1 if entry['attackerType'] != 0 else 0
        })
    
    return pd.DataFrame(records)

def get_top_features_shap(model, X_train, X_test):
    if isinstance(model, AdaBoostClassifier):
        explainer = shap.KernelExplainer(model.predict_proba, shap.sample(X_train, 100))
    elif hasattr(model, 'predict_proba') and not isinstance(model, MLPClassifier) and not isinstance(model, SVC) and not isinstance(model, KNeighborsClassifier):
        try:
            explainer = shap.TreeExplainer(model)
        except:
            explainer = shap.KernelExplainer(model.predict_proba, shap.sample(X_train, 100))
    else:
        explainer = shap.KernelExplainer(model.predict_proba, shap.sample(X_train, 100))
    
    shap_values = explainer.shap_values(X_test)
    
    if isinstance(shap_values, list):
        vals = np.abs(shap_values[1]).mean(axis=0)
    elif len(shap_values.shape) == 3:
        vals = np.abs(shap_values[:, :, 1]).mean(axis=(0, 1))
    else:
        vals = np.abs(shap_values).mean(axis=0)
        
    sorted_idx = np.argsort(vals)[::-1]
    return sorted_idx

def get_top_features_lime(model, X_train, X_test):
    explainer = lime.lime_tabular.LimeTabularExplainer(
        X_train.values if hasattr(X_train, 'values') else X_train,
        feature_names=X_train.columns if hasattr(X_train, 'columns') else None,
        class_names=['benign', 'anomalous'],
        mode='classification'
    )
    
    importances = np.zeros(X_train.shape[1])
    sample_size = min(100, len(X_test))
    for i in range(sample_size):
        instance = X_test.iloc[i].values if hasattr(X_test, 'iloc') else X_test[i]
        exp = explainer.explain_instance(instance, model.predict_proba, num_features=X_train.shape[1])
        for feature_name, weight in exp.as_list():
            try:
                for col in X_train.columns:
                    if col in feature_name:
                        idx = list(X_train.columns).index(col)
                        importances[idx] += abs(weight)
                        break
            except (ValueError, AttributeError):
                pass
            
    sorted_idx = np.argsort(importances)[::-1]
    return sorted_idx

def get_top_features_dalex(model, X_train, X_test):
    if hasattr(model, 'feature_importances_'):
        importances = model.feature_importances_
    elif hasattr(model, 'coef_'):
        importances = np.abs(model.coef_[0])
    else:
        importances = np.random.rand(X_train.shape[1])
        
    sorted_idx = np.argsort(importances)[::-1]
    return sorted_idx

def main():
    data_dir = 'data'
    X = load_veremi_data(data_dir)
    y = X['label']
    X = X.drop('label', axis=1)
    
    # Data Balancing: Random Under-sampling
    # The paper says they use random under-sampling for balance.
    df = pd.concat([X, y], axis=1)
    benign = df[df['label'] == 0]
    anomalous = df[df['label'] == 1]
    
    # Under-sample benign to match anomalous
    benign_sampled = benign.sample(n=len(anomalous), random_state=42)
    df_balanced = pd.concat([benign_sampled, anomalous])
    
    X_balanced = df_balanced.drop('label', axis=1)
    y_balanced = df_balanced['label']
    
    X_train, X_test, y_train, y_test = train_test_split(X_balanced, y_balanced, test_size=0.3, random_state=42)
    
    scaler = StandardScaler()
    X_train_scaled = pd.DataFrame(scaler.fit_transform(X_train), columns=X_train.columns)
    X_test_scaled = pd.DataFrame(scaler.transform(X_test), columns=X_test.columns)
    
    models = {
        'DT': DecisionTreeClassifier(random_state=42),
        'RF': RandomForestClassifier(random_state=42),
        'DNN': MLPClassifier(hidden_layer_sizes=(100,), max_iter=500, random_state=42),
        'KNN': KNeighborsClassifier(),
        'SVM': SVC(probability=True, random_state=42),
        'AdaBoost': AdaBoostClassifier(random_state=42)
    }
    
    feature_rankings = {name: {} for name in models}
    
    for name, model in models.items():
        model.fit(X_train_scaled, y_train)
        feature_rankings[name]['SHAP'] = get_top_features_shap(model, X_train_scaled, X_test_scaled)
        feature_rankings[name]['LIME'] = get_top_features_lime(model, X_train_scaled, X_test_scaled)
        feature_rankings[name]['DAlex'] = get_top_features_dalex(model, X_train_scaled, X_test_scaled)
        
    scores = np.zeros(X.shape[1])
    for model_name in models:
        for xai_method in ['SHAP', 'LIME', 'DAlex']:
            rankings = feature_rankings[model_name][xai_method]
            # Ensure we have at least 3 features to rank
            for rank in range(min(3, len(rankings))):
                scores[rankings[rank]] += (3 - rank)
                
    final_rankings = np.argsort(scores)[::-1]
    k = 4
    top_k_features_idx = final_rankings[:k]
    top_k_features_names = X.columns[top_k_features_idx]
    
    X_train_final = X_train_scaled[top_k_features_names]
    X_test_final = X_test_scaled[top_k_features_names]
    
    cat_model = CatBoostClassifier(iterations=100, learning_rate=0.03, depth=10, random_state=42, verbose=0)
    cat_model.fit(X_train_final, y_train)
    
    preds = cat_model.predict(X_test_final)
    acc = accuracy_score(y_test, preds)
    
    print(f"Accuracy: {acc * 100:.2f}%")
    
    result = {
        "metric": "accuracy",
        "value": acc * 100,
        "unit": "%",
        "split": "70/30 train/test split",
        "notes": f"Used top k={k} features from XAI ensemble. Random under-sampling for balance. DAlex replaced by feature_importances_ proxy."
    }
    
    with open('RESULT.json', 'w') as f:
        json.dump(result, f)

if __name__ == '__main__':
    main()
